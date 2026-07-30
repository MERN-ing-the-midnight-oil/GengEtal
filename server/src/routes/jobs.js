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
} from '../db.js';
import {
  appendJobToQueue,
  isAuthenticated,
  isDriveConfigured,
  removeJobFromQueue,
} from '../services/drive.js';
import { getNotebookSettings } from '../services/settings.js';
import { getSyncStatus, refreshColabStatus, syncOnce } from '../services/sync.js';
import { config } from '../config.js';

const router = express.Router();

/** How long a generating job may go without heartbeat updates before we call it stuck. */
const COLAB_STUCK_THRESHOLD_MS = Number(process.env.COLAB_STUCK_THRESHOLD_MS || 25 * 60 * 1000);

function deriveWorkerPhase(colab) {
  const heartbeat = colab?.heartbeat;
  const ageMs = Number.isFinite(colab?.ageMs) ? colab.ageMs : null;
  const online = Boolean(colab?.online);
  const hbStatus = String(heartbeat?.status || '').toLowerCase();
  const currentJob = heartbeat?.current_job || null;
  const error = heartbeat?.error || colab?.error || null;

  if (hbStatus === 'error' && ageMs != null && ageMs <= COLAB_STUCK_THRESHOLD_MS) {
    return {
      phase: 'error',
      label: 'Worker error',
      detail: error || 'The Colab poll loop reported an error.',
      currentJob,
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
        ageMs,
      };
    }
    return {
      phase: 'busy',
      label: 'Generating in Colab',
      detail: `Working on ${currentJob}.`,
      currentJob,
      ageMs,
    };
  }

  if (currentJob && ageMs != null && ageMs > COLAB_STUCK_THRESHOLD_MS) {
    return {
      phase: 'stuck',
      label: 'Worker looks stuck',
      detail: `Still marked as working on ${currentJob}, but no heartbeat for ${formatAge(ageMs)}. Check the Colab tab for a hung cell or runtime disconnect.`,
      currentJob,
      ageMs,
    };
  }

  if (online) {
    return {
      phase: 'online',
      label: 'Colab is online',
      detail: 'Worker heartbeat received — queue a prompt pair whenever you’re ready.',
      currentJob: null,
      ageMs,
    };
  }

  if (heartbeat?.last_seen && ageMs != null) {
    return {
      phase: 'not_running',
      label: 'Opened but not running',
      detail: `Last heartbeat ${formatAge(ageMs)} ago. Open the notebook and use Runtime → Run all, then leave the poll loop running.`,
      currentJob: null,
      ageMs,
    };
  }

  return {
    phase: 'offline',
    label: 'Colab is offline',
    detail: 'No worker heartbeat yet. Open the notebook, set A100 + High-RAM, then Runtime → Run all.',
    currentJob: null,
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
  const notebook = getNotebookSettings();
  const worker = deriveWorkerPhase(colab);
  res.json({
    colabOnline: Boolean(colab?.online),
    colab,
    worker,
    notebookUrl:
      notebook.url || config.colabNotebookUrl || config.templateNotebookUrl,
    notebook,
    authenticated: isAuthenticated(),
    driveConfigured: isDriveConfigured(),
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

router.get('/:id/image', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.local_image_path || !fs.existsSync(job.local_image_path)) {
    return res.status(404).json({ error: 'Image not available yet' });
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.resolve(job.local_image_path));
});

router.delete('/:id', async (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

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
        });
      } catch (err) {
        console.error('Failed to write job to Drive:', err);
        return res.status(201).json({
          job: toPublicJob(job),
          warning: `Job saved locally but Drive sync failed: ${err.message}`,
        });
      }
    }

    res.status(201).json({ job: toPublicJob(job) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;