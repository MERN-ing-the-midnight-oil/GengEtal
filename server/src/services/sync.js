import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import {
  getAllJobs,
  getJob,
  updateJob,
  upsertJobFromRemote,
} from '../db.js';
import {
  downloadFile,
  findResultImage,
  isDriveConfigured,
  readHeartbeat,
  readJobQueue,
  writeJobQueue,
} from './drive.js';

let syncing = false;
let lastSyncAt = null;
let lastSyncError = null;
let colabStatus = { online: false, heartbeat: null };

export function getSyncStatus() {
  return {
    lastSyncAt,
    lastSyncError,
    syncing,
    colab: colabStatus,
  };
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

async function ensureLocalImage(job) {
  if (job.local_image_path && fs.existsSync(job.local_image_path)) {
    return job;
  }
  if (job.status !== 'completed') return job;

  const result = await findResultImage(job.id);
  if (!result) return job;

  const dest = path.join(config.imageCacheDir, `${job.id}.png`);
  await downloadFile(result.fileId, dest);
  return updateJob(job.id, {
    image_path: result.name,
    local_image_path: dest,
    updated_at: new Date().toISOString(),
  });
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
    const remote = await readJobQueue();
    const remoteById = new Map(remote.jobs.map((j) => [j.id, j]));
    const localJobs = getAllJobs();

    // Push local jobs missing from Drive
    let changed = false;
    for (const local of localJobs) {
      if (!remoteById.has(local.id)) {
        remote.jobs.push({
          id: local.id,
          prompt_1: local.prompt_1,
          prompt_2: local.prompt_2,
          status: local.status,
          created_at: local.created_at,
          updated_at: local.updated_at,
          completed_at: local.completed_at,
          error_message: local.error_message,
        });
        changed = true;
      }
    }
    if (changed) {
      await writeJobQueue(remote.jobs);
    }

    // Pull remote updates
    for (const remoteJob of remote.jobs) {
      upsertJobFromRemote(remoteJob);
      const local = getJob(remoteJob.id);
      if (local?.status === 'completed') {
        await ensureLocalImage(local);
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
  setInterval(() => {
    syncOnce();
  }, config.syncIntervalMs);
}