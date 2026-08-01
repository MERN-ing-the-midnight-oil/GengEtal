import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import {
  getAllJobs,
  getJob,
  updateJob,
  upsertJobFromRemote,
} from '../db.js';
import { randomInt } from 'crypto';
import { getActiveAccountId } from './accounts.js';
import {
  downloadFile,
  ensureJobResultPlaceholder,
  findResultImage,
  isDriveConfigured,
  MIN_RESULT_IMAGE_BYTES,
  readHeartbeat,
  readJobQueue,
  writeJobQueue,
} from './drive.js';
import { getGenerationSettings, getWorkerTier } from './settings.js';
import { estimateJobBurn } from './burnEstimate.js';

function localImageLooksReal(filePath) {
  try {
    const { size } = fs.statSync(filePath);
    return size >= MIN_RESULT_IMAGE_BYTES;
  } catch {
    return false;
  }
}

let syncing = false;
let lastSyncAt = null;
let lastSyncError = null;
let colabStatus = { online: false, heartbeat: null };
let syncTimer = null;

export function getSyncStatus() {
  return {
    lastSyncAt,
    lastSyncError,
    syncing,
    colab: colabStatus,
  };
}

/** Clear cached Colab/Drive sync state after switching Google accounts. */
export function resetSyncState() {
  colabStatus = { online: false, heartbeat: null, reason: 'account_switched' };
  lastSyncAt = null;
  lastSyncError = null;
}

export async function refreshColabStatus() {
  if (!isDriveConfigured()) {
    colabStatus = { online: false, heartbeat: null, reason: 'drive_not_configured' };
    return colabStatus;
  }

  try {
    const heartbeat = await readHeartbeat();
    if (!heartbeat?.last_seen) {
      colabStatus = { online: false, heartbeat: null };
      return colabStatus;
    }

    const age = Date.now() - new Date(heartbeat.last_seen).getTime();
    const online = Number.isFinite(age) && age <= config.colabOnlineThresholdMs;
    colabStatus = {
      online,
      heartbeat,
      ageMs: age,
    };
    return colabStatus;
  } catch (err) {
    colabStatus = { online: false, heartbeat: null, error: err.message };
    return colabStatus;
  }
}

async function ensureLocalImage(job, preferredFileId = null) {
  if (job.status !== 'completed') return job;

  const dest = path.join(config.imageCacheDir, `${job.id}.png`);
  const hasRealLocal =
    job.local_image_path &&
    fs.existsSync(job.local_image_path) &&
    localImageLooksReal(job.local_image_path);

  if (hasRealLocal) return job;

  // Drop a cached placeholder so the UI doesn't treat it as a finished image.
  if (job.local_image_path && fs.existsSync(job.local_image_path)) {
    try {
      fs.unlinkSync(job.local_image_path);
    } catch {
      /* ignore */
    }
  }
  if (job.local_image_path) {
    job = updateJob(job.id, {
      local_image_path: null,
      updated_at: new Date().toISOString(),
    });
  }

  async function acceptDownload(fileId, imageName) {
    if (!fileId) return null;
    await downloadFile(fileId, dest);
    if (!localImageLooksReal(dest)) {
      try {
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      return null;
    }
    return updateJob(job.id, {
      image_path: imageName,
      local_image_path: dest,
      updated_at: new Date().toISOString(),
    });
  }

  // Prefer the app-owned placeholder file id, but Colab's mount write sometimes
  // lands in a duplicate folder — fall back to scanning for a real PNG.
  const preferred = await acceptDownload(preferredFileId, 'image_1024.png');
  if (preferred) return preferred;

  const result = await findResultImage(job.id);
  if (!result || result.fileId === preferredFileId) return job;
  return (await acceptDownload(result.fileId, result.name)) || job;
}

/**
 * Push any local-only pending jobs that aren't on Drive yet,
 * then pull remote status/image updates into SQLite.
 */
export async function syncOnce() {
  if (syncing) return getSyncStatus();
  if (!isDriveConfigured()) {
    lastSyncError = 'Google Drive credentials not configured';
    return getSyncStatus();
  }

  syncing = true;
  lastSyncError = null;

  try {
    const accountId = getActiveAccountId();
    const remote = await readJobQueue();
    const remoteById = new Map(remote.jobs.map((j) => [j.id, j]));
    // Only sync jobs belonging to the active Google account — never spill into another Drive.
    const localJobs = getAllJobs({ googleAccountId: accountId || undefined });

    // Push local jobs missing from Drive, and backfill result_file_id for Colab uploads.
    // Always include generation settings — a bare stub makes Colab default to 1024/30 and often OOM/fail.
    let changed = false;
    const generation = getGenerationSettings();
    const tier = getWorkerTier();
    for (const local of localJobs) {
      if (!remoteById.has(local.id)) {
        const placeholder = await ensureJobResultPlaceholder(local.id);
        const burn = estimateJobBurn({
          tier,
          resolution: generation.resolution,
          num_inference_steps: generation.num_inference_steps,
        });
        remote.jobs.push({
          id: local.id,
          prompt_1: local.prompt_1,
          prompt_2: local.prompt_2,
          status: local.status,
          created_at: local.created_at,
          updated_at: local.updated_at,
          completed_at: local.completed_at,
          error_message: local.error_message,
          seed: randomInt(0, 2 ** 31),
          tier,
          resolution: generation.resolution,
          num_inference_steps: generation.num_inference_steps,
          generate_1024: generation.generate_1024,
          estimated_cu: burn.expectedCu,
          result_folder_id: placeholder.folderId,
          result_file_id: placeholder.fileId,
        });
        changed = true;
      }
    }
    for (const remoteJob of remote.jobs) {
      if (remoteJob.result_file_id) continue;
      const placeholder = await ensureJobResultPlaceholder(remoteJob.id);
      remoteJob.result_folder_id = placeholder.folderId;
      remoteJob.result_file_id = placeholder.fileId;
      changed = true;
    }
    if (changed) {
      await writeJobQueue(remote.jobs);
    }

    // Pull remote updates
    for (const remoteJob of remote.jobs) {
      upsertJobFromRemote({
        ...remoteJob,
        google_account_id: accountId || remoteJob.google_account_id || null,
      });
      const local = getJob(remoteJob.id);
      if (local?.status === 'completed') {
        await ensureLocalImage(local, remoteJob.result_file_id || null);
      }
    }

    await refreshColabStatus();
    lastSyncAt = new Date().toISOString();
  } catch (err) {
    lastSyncError = err.message;
    console.error('Sync error:', err);
  } finally {
    syncing = false;
  }

  return getSyncStatus();
}

export function startSyncLoop() {
  if (!isDriveConfigured()) {
    console.warn('Drive not configured — sync loop idle. Complete OAuth setup first.');
    return;
  }

  syncOnce();
  if (syncTimer) return;
  syncTimer = setInterval(() => {
    syncOnce();
  }, config.syncIntervalMs);
}