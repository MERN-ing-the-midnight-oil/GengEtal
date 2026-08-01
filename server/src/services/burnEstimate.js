import {
  getGenerationSettings,
  getSetting,
  getWorkerTier,
  setSetting,
} from './settings.js';
import { getAllJobs } from '../db.js';

/**
 * Seeded from this project: 100 CU spent, 11 remaining completed jobs + 3 deleted
 * jobs that still have real result PNGs on Drive.
 */
const DEFAULT_CAL_UNITS = 100;
const DEFAULT_CAL_JOBS = 14;
const DEFAULT_DELETED_JOBS = 3;

export function getDeletedJobCount() {
  const n = Number(getSetting('burn_deleted_jobs', String(DEFAULT_DELETED_JOBS)));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_DELETED_JOBS;
}

/** Call when the user deletes a job that had already consumed GPU time. */
export function recordDeletedJobBurn(job) {
  if (!job) return getDeletedJobCount();
  const burned =
    job.status === 'completed' ||
    job.status === 'processing' ||
    Boolean(job.local_image_path) ||
    Boolean(job.completed_at);
  if (!burned) return getDeletedJobCount();

  const next = getDeletedJobCount() + 1;
  setSetting('burn_deleted_jobs', String(next));

  // Keep calibrated job count in sync if it was still on the auto defaults.
  const calJobs = Number(getSetting('burn_cal_jobs', String(DEFAULT_CAL_JOBS)));
  const liveCompleted = countLiveCompletedJobs();
  if (!Number.isFinite(calJobs) || calJobs === liveCompleted + next - 1) {
    setSetting('burn_cal_jobs', String(liveCompleted + next));
  }
  return next;
}

function countLiveCompletedJobs() {
  return getAllJobs().filter((j) => j.status === 'completed').length;
}

export function getBurnCalibration() {
  const units = Number(getSetting('burn_cal_units', String(DEFAULT_CAL_UNITS)));
  const deletedJobs = getDeletedJobCount();
  const liveCompleted = countLiveCompletedJobs();
  const defaultJobs = Math.max(DEFAULT_CAL_JOBS, liveCompleted + deletedJobs);
  const jobs = Number(getSetting('burn_cal_jobs', String(defaultJobs)));
  const budget = Number(getSetting('burn_budget_units', String(DEFAULT_CAL_UNITS)));
  const safeUnits = Number.isFinite(units) && units > 0 ? units : DEFAULT_CAL_UNITS;
  const safeJobs = Number.isFinite(jobs) && jobs > 0 ? jobs : defaultJobs;
  const safeBudget = Number.isFinite(budget) && budget >= 0 ? budget : DEFAULT_CAL_UNITS;
  return {
    calibratedUnits: safeUnits,
    calibratedJobs: safeJobs,
    deletedJobs,
    liveCompletedJobs: liveCompleted,
    unitsPerBaselineJob: safeUnits / safeJobs,
    budgetUnits: safeBudget,
    note:
      'Baseline includes deleted jobs and amortized setup/idle time, not pure GPU-seconds for one generate.py call.',
  };
}

export function setBurnCalibration({
  calibratedUnits,
  calibratedJobs,
  budgetUnits,
  deletedJobs,
} = {}) {
  if (calibratedUnits != null) {
    const n = Number(calibratedUnits);
    if (Number.isFinite(n) && n > 0) setSetting('burn_cal_units', String(n));
  }
  if (deletedJobs != null) {
    const n = Number(deletedJobs);
    if (Number.isFinite(n) && n >= 0) setSetting('burn_deleted_jobs', String(Math.round(n)));
  }
  if (calibratedJobs != null) {
    const n = Number(calibratedJobs);
    if (Number.isFinite(n) && n > 0) setSetting('burn_cal_jobs', String(Math.round(n)));
  } else if (deletedJobs != null) {
    // If only deleted count changed, refresh total jobs = live + deleted.
    const liveCompleted = countLiveCompletedJobs();
    setSetting('burn_cal_jobs', String(liveCompleted + getDeletedJobCount()));
  }
  if (budgetUnits != null) {
    const n = Number(budgetUnits);
    if (Number.isFinite(n) && n >= 0) setSetting('burn_budget_units', String(n));
  }
  return getBurnCalibration();
}

/**
 * Estimate compute units for one job under the current (or provided) settings.
 * Baseline ≈ Pro / A100 / 1024 / 30 steps from local calibration.
 */
export function estimateJobBurn(overrides = {}) {
  const cal = getBurnCalibration();
  const generation = getGenerationSettings();
  const tier = overrides.tier || getWorkerTier();
  const resolution = String(overrides.resolution || generation.resolution || '1024');
  const steps = Number(overrides.num_inference_steps || generation.num_inference_steps || 30);

  let mult = 1;
  // GPU class
  if (tier === 'free') mult *= 0.32;
  // Upscaler / resolution
  if (resolution === '256') mult *= tier === 'free' ? 1 : 0.55;
  // Diffusion steps (baseline 30)
  const stepRatio = Math.max(5, Math.min(50, steps)) / 30;
  mult *= stepRatio;

  const expected = cal.unitsPerBaselineJob * mult;
  const low = expected * 0.7;
  const high = expected * 1.45;

  return {
    expectedCu: round1(expected),
    lowCu: round1(low),
    highCu: round1(high),
    tier,
    resolution,
    num_inference_steps: Math.round(steps),
    baselineCu: round1(cal.unitsPerBaselineJob),
    calibration: cal,
    summary:
      tier === 'free'
        ? `~${round1(expected)} CU (T4 · ${resolution} · ${Math.round(steps)} steps)`
        : `~${round1(expected)} CU (A100 · ${resolution} · ${Math.round(steps)} steps)`,
    warning:
      expected >= 8
        ? 'High burn — consider 256×256, fewer steps, or Free/T4.'
        : expected >= 4
          ? 'Moderate burn. Disconnect Colab when the queue is empty.'
          : 'Lower burn settings. Still disconnect Colab when idle.',
  };
}

export function getBurnStatus() {
  const estimate = estimateJobBurn();
  const cal = estimate.calibration;
  return {
    estimate,
    calibration: cal,
    jobsPerBudget: estimate.expectedCu > 0
      ? Math.max(0, Math.floor(cal.budgetUnits / estimate.expectedCu))
      : null,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
