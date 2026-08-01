/** Per-job completion alerts: screen flash + chime with exponential backoff. */

const INITIAL_GAP_MS = 5_000;
const MAX_GAP_MS = 10 * 60 * 1000;

let audioCtx = null;
const armed = new Set();
const ringing = new Set();
const timers = new Map();
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeJobAlerts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAlertState(jobId) {
  if (ringing.has(jobId)) return 'ringing';
  if (armed.has(jobId)) return 'armed';
  return 'off';
}

export function hasArmedJobAlerts() {
  return armed.size > 0;
}

export function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

function flashScreen() {
  const el = document.createElement('div');
  el.className = 'alert-flash';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function playChime() {
  const ctx = unlockAudio();
  if (!ctx) return;

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  master.connect(ctx.destination);

  for (const [freq, startOffset, duration] of [
    [880, 0, 0.28],
    [1175, 0.12, 0.35],
  ]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t0 = now + startOffset;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.9, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }
}

function pulse() {
  flashScreen();
  playChime();
}

function clearTimer(jobId) {
  const timer = timers.get(jobId);
  if (timer != null) {
    clearTimeout(timer);
    timers.delete(jobId);
  }
}

function stopRinging(jobId) {
  ringing.delete(jobId);
  clearTimer(jobId);
}

export function armJobAlert(jobId) {
  unlockAudio();
  stopRinging(jobId);
  armed.add(jobId);
  notify();
}

export function dismissJobAlert(jobId) {
  const changed = armed.delete(jobId) || ringing.has(jobId);
  stopRinging(jobId);
  if (changed) notify();
}

function startRinging(jobId) {
  if (ringing.has(jobId)) return;

  armed.delete(jobId);
  ringing.add(jobId);
  notify();

  // 5s, then 10s, then 20s, …
  let gapMs = INITIAL_GAP_MS;
  const scheduleNext = () => {
    const timer = setTimeout(() => {
      if (!ringing.has(jobId)) return;
      pulse();
      gapMs = Math.min(gapMs * 2, MAX_GAP_MS);
      scheduleNext();
    }, gapMs);
    timers.set(jobId, timer);
  };
  scheduleNext();
}

/** Call when the jobs list refreshes so armed alerts can fire on image sync. */
export function syncJobAlerts(jobs) {
  let changed = false;
  for (const job of jobs) {
    if (!armed.has(job.id)) continue;
    if (job.has_image) {
      startRinging(job.id);
      changed = true;
    } else if (job.status === 'failed') {
      armed.delete(job.id);
      changed = true;
    }
  }
  if (changed) notify();
}
