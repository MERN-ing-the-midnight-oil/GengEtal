import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomInt, randomUUID } from 'crypto';
import {
  createJob,
  deleteJob,
  getAllJobs,
  getJob,
  toPublicJob,
  updateJob,
} from '../db.js';
import { getActiveAccount } from '../services/accounts.js';
import {
  appendJobToQueue,
  isAuthenticated,
  isDriveConfigured,
  removeJobFromQueue,
} from '../services/drive.js';
import {
  publishJobToGallery,
  unpublishJobFromGallery,
} from '../services/gallery.js';
import {
  estimateJobBurn,
  getBurnStatus,
  recordDeletedJobBurn,
} from '../services/burnEstimate.js';
import {
  getGenerationSettings,
  getNotebookSettings,
  getWorkerTier,
  getWorkerTierInfo,
} from '../services/settings.js';
import { getSyncStatus, refreshColabStatus, syncOnce } from '../services/sync.js';
import { config } from '../config.js';

const router = express.Router();

/** How long a generating job may go without heartbeat updates before we call it stuck. */
const COLAB_STUCK_THRESHOLD_MS = Number(process.env.COLAB_STUCK_THRESHOLD_MS || 25 * 60 * 1000);
/** Pip install / clone can take a while — keep setup progress visible longer than the online threshold. */
const COLAB_SETUP_FRESH_MS = Number(process.env.COLAB_SETUP_FRESH_MS || 20 * 60 * 1000);

const SETUP_STEP_LABELS = {
  drive: 'Mounting Google Drive…',
  deps: 'Installing dependencies…',
  hf: 'Logging in to Hugging Face…',
  clone: 'Cloning generate.py repo…',
  ready: 'Worker loop starting…',
};

function normalizeSetupStep(value) {
  const step = String(value || '').toLowerCase();
  return SETUP_STEP_LABELS[step] ? step : null;
}

function deriveWorkerPhase(colab) {
  const heartbeat = colab?.heartbeat;
  const ageMs = Number.isFinite(colab?.ageMs) ? colab.ageMs : null;
  const online = Boolean(colab?.online);
  const hbStatus = String(heartbeat?.status || '').toLowerCase();
  const currentJob = heartbeat?.current_job || null;
  const error = heartbeat?.error || colab?.error || null;
  const setupStep = normalizeSetupStep(heartbeat?.setup_step);

  if (hbStatus === 'error' && ageMs != null && ageMs <= COLAB_STUCK_THRESHOLD_MS) {
    return {
      phase: 'error',
      label: 'Worker error',
      detail: error || 'The Colab poll loop reported an error.',
      currentJob,
      setupStep,
      ageMs,
    };
  }

  // Heartbeat pauses during long generate.py runs — treat recent current_job as busy.
  if (currentJob && ageMs != null && ageMs <= COLAB_STUCK_THRESHOLD_MS) {
    if (ageMs > config.colabOnlineThresholdMs) {
      return {
        phase: 'busy',
        label: 'Generating in Colab',
        detail: `Working on ${currentJob}. Heartbeat pauses during generation — this can take several minutes.`,
        currentJob,
        setupStep: setupStep || 'ready',
        ageMs,
      };
    }
    return {
      phase: 'busy',
      label: 'Generating in Colab',
      detail: `Working on ${currentJob}.`,
      currentJob,
      setupStep: setupStep || 'ready',
      ageMs,
    };
  }

  if (currentJob && ageMs != null && ageMs > COLAB_STUCK_THRESHOLD_MS) {
    return {
      phase: 'stuck',
      label: 'Worker looks stuck',
      detail: `Still marked as working on ${currentJob}, but no heartbeat for ${formatAge(ageMs)}. Check the Colab tab for a hung cell or runtime disconnect.`,
      currentJob,
      setupStep,
      ageMs,
    };
  }

  // Notebook cells write status=starting + setup_step before the poll loop is up.
  if (
    setupStep &&
    setupStep !== 'ready' &&
    ageMs != null &&
    ageMs <= COLAB_SETUP_FRESH_MS
  ) {
    return {
      phase: 'starting',
      label: 'Colab is starting…',
      detail: SETUP_STEP_LABELS[setupStep] || 'Running notebook setup…',
      currentJob: null,
      setupStep,
      ageMs,
    };
  }

  if (online) {
    return {
      phase: 'online',
      label: 'Colab is online',
      detail: 'Worker heartbeat received — queue a prompt pair whenever you’re ready.',
      currentJob: null,
      setupStep: setupStep || 'ready',
      ageMs,
    };
  }

  if (heartbeat?.last_seen && ageMs != null) {
    return {
      phase: 'not_running',
      label: 'Opened but not running',
      detail: `Last heartbeat ${formatAge(ageMs)} ago. Open the notebook and use Runtime → Run all, then leave the poll loop running.`,
      currentJob: null,
      setupStep,
      ageMs,
    };
  }

  const tier = getWorkerTierInfo();
  const runtimeHint = tier.highRam
    ? `${tier.accelerator} + High-RAM`
    : tier.accelerator;
  return {
    phase: 'offline',
    label: 'Colab is offline',
    detail: `No worker heartbeat yet. Open the ${tier.label} notebook, set ${runtimeHint}, then Runtime → Run all.`,
    currentJob: null,
    setupStep: null,
    ageMs,
  };
}

function formatAge(ms) {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  return `${hr}h`;
}

router.get('/', (req, res) => {
  const { status, q } = req.query;
  const jobs = getAllJobs({ status, q }).map(toPublicJob);
  res.json({ jobs, sync: getSyncStatus() });
});

router.get('/status', async (_req, res) => {
  const colab = await refreshColabStatus();
  const sync = getSyncStatus();
  const workerTier = getWorkerTierInfo();
  const notebook = getNotebookSettings(workerTier.tier);
  const worker = deriveWorkerPhase(colab);
  const fallbackUrl =
    workerTier.tier === 'pro'
      ? config.colabNotebookUrl || config.templateNotebookUrl
      : null;
  res.json({
    colabOnline: Boolean(colab?.online),
    colab,
    worker,
    workerTier,
    notebookUrl: notebook.url || fallbackUrl,
    notebook,
    generation: getGenerationSettings(),
    burn: getBurnStatus(),
    authenticated: isAuthenticated(),
    driveConfigured: isDriveConfigured(),
    googleAccount: getActiveAccount(),
    lastSyncAt: sync.lastSyncAt,
    lastSyncError: sync.lastSyncError,
  });
});

router.post('/sync', async (_req, res) => {
  try {
    const status = await syncOnce();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: toPublicJob(job) });
});

router.post('/:id/publish', async (req, res) => {
  try {
    if (!isDriveConfigured() || !isAuthenticated()) {
      return res.status(401).json({ error: 'Sign in with Google first' });
    }
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const result = await publishJobToGallery(job);
    const updated = updateJob(job.id, {
      published: 1,
      gallery_file_id: result.fileId,
      updated_at: new Date().toISOString(),
    });
    res.json({ job: toPublicJob(updated), share: result.share });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/publish', async (req, res) => {
  try {
    if (!isDriveConfigured() || !isAuthenticated()) {
      return res.status(401).json({ error: 'Sign in with Google first' });
    }
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const result = await unpublishJobFromGallery(job.id);
    const updated = updateJob(job.id, {
      published: 0,
      gallery_file_id: null,
      updated_at: new Date().toISOString(),
    });
    res.json({ job: toPublicJob(updated), share: result.share });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/image', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.local_image_path || !fs.existsSync(job.local_image_path)) {
    return res.status(404).json({ error: 'Image not available yet' });
  }
  // Reject the 1×1 Drive placeholder if it was cached before Colab flushed.
  try {
    if (fs.statSync(job.local_image_path).size < config.minResultImageBytes) {
      return res.status(404).json({ error: 'Image not available yet' });
    }
  } catch {
    return res.status(404).json({ error: 'Image not available yet' });
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.resolve(job.local_image_path));
});

router.delete('/:id', async (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Count GPU-consuming deletes toward burn calibration before removing the row.
    recordDeletedJobBurn(job);

    // Remove from Drive first so the sync loop cannot upsert the job back.
    if (isDriveConfigured()) {
      try {
        await removeJobFromQueue(job.id);
      } catch (err) {
        console.error('Failed to remove job from Drive queue:', err);
        return res.status(502).json({
          error: `Could not remove job from Drive queue: ${err.message}`,
        });
      }
      if (job.published) {
        try {
          await unpublishJobFromGallery(job.id);
        } catch (err) {
          console.warn('Failed to unpublish deleted job:', err.message);
        }
      }
    }

    deleteJob(job.id);

    if (job.local_image_path && fs.existsSync(job.local_image_path)) {
      try {
        fs.unlinkSync(job.local_image_path);
      } catch (err) {
        console.warn('Failed to remove cached image:', err.message);
      }
    }

    res.json({ ok: true, id: job.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const prompt_1 = String(req.body?.prompt_1 || '').trim();
    const prompt_2 = String(req.body?.prompt_2 || '').trim();

    if (!prompt_1 || !prompt_2) {
      return res.status(400).json({ error: 'prompt_1 and prompt_2 are required' });
    }

    const now = new Date().toISOString();
    const id = `job_${randomUUID().slice(0, 8)}`;
    // Per-job seed so rerolls of the same prompts can produce different images.
    const seed = randomInt(0, 2 ** 31);

    const job = createJob({
      id,
      prompt_1,
      prompt_2,
      status: 'pending',
      created_at: now,
      updated_at: now,
    });

    if (isDriveConfigured()) {
      try {
        const generation = getGenerationSettings();
        const burn = estimateJobBurn({
          tier: getWorkerTier(),
          resolution: generation.resolution,
          num_inference_steps: generation.num_inference_steps,
        });
        await appendJobToQueue({
          id: job.id,
          prompt_1: job.prompt_1,
          prompt_2: job.prompt_2,
          status: job.status,
          created_at: job.created_at,
          updated_at: job.updated_at,
          completed_at: null,
          error_message: null,
          seed,
          tier: getWorkerTier(),
          resolution: generation.resolution,
          num_inference_steps: generation.num_inference_steps,
          generate_1024: generation.generate_1024,
          estimated_cu: burn.expectedCu,
        });
      } catch (err) {
        console.error('Failed to write job to Drive:', err);
        return res.status(201).json({
          job: toPublicJob(job),
          burn: getBurnStatus(),
          warning: `Job saved locally but Drive sync failed: ${err.message}`,
        });
      }
    }

    res.status(201).json({ job: toPublicJob(job), burn: getBurnStatus() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;