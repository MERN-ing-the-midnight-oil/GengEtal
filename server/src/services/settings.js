import db from '../db.js';
import { getActiveAccountId } from './accounts.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
  return value;
}

/** Notebook URLs live on each Google Drive — keep them keyed by active account. */
function accountKeyPrefix() {
  const id = getActiveAccountId();
  if (!id) return '';
  // Settings keys cannot contain some chars; permissionIds are alphanumeric.
  const safe = String(id).replace(/[^a-zA-Z0-9:_-]/g, '_');
  return `acct_${safe}__`;
}

function migrateLegacyNotebookKeysIfNeeded(prefix, basePrefix) {
  if (!prefix) return;
  if (getSetting(`${prefix}${basePrefix}_file_id`)) return;
  const legacyFileId = getSetting(`${basePrefix}_file_id`);
  const legacyUrl = getSetting(`${basePrefix}_url`);
  if (!legacyFileId || !legacyUrl) return;
  for (const suffix of [
    'file_id',
    'url',
    'name',
    'is_owner',
    'copied',
    'manual_copy_hint',
  ]) {
    const legacy = getSetting(`${basePrefix}_${suffix}`);
    if (legacy != null) setSetting(`${prefix}${basePrefix}_${suffix}`, legacy);
  }
}

/** When a temporary account id is replaced, copy its notebook settings over. */
export function remapNotebookSettingsAccount(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const safeFrom = String(fromId).replace(/[^a-zA-Z0-9:_-]/g, '_');
  const safeTo = String(toId).replace(/[^a-zA-Z0-9:_-]/g, '_');
  const fromPrefix = `acct_${safeFrom}__`;
  const toPrefix = `acct_${safeTo}__`;
  for (const base of ['notebook', 'notebook_free']) {
    if (getSetting(`${toPrefix}${base}_file_id`)) continue;
    for (const suffix of [
      'file_id',
      'url',
      'name',
      'is_owner',
      'copied',
      'manual_copy_hint',
    ]) {
      const value = getSetting(`${fromPrefix}${base}_${suffix}`);
      if (value != null) setSetting(`${toPrefix}${base}_${suffix}`, value);
    }
  }
}

/** Copy friends-list settings when a temporary account id is replaced. */
export function remapFriendsSettingsAccount(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const safeFrom = String(fromId).replace(/[^a-zA-Z0-9:_-]/g, '_');
  const safeTo = String(toId).replace(/[^a-zA-Z0-9:_-]/g, '_');
  const fromKey = `acct_${safeFrom}__friends`;
  const toKey = `acct_${safeTo}__friends`;
  if (getSetting(toKey)) return;
  const value = getSetting(fromKey);
  if (value != null) setSetting(toKey, value);
}

export function getWorkerTier() {
  const raw = String(getSetting('worker_tier', 'pro') || 'pro').toLowerCase();
  return raw === 'free' ? 'free' : 'pro';
}

export function setWorkerTier(tier) {
  const next = String(tier || '').toLowerCase() === 'free' ? 'free' : 'pro';
  setSetting('worker_tier', next);
  return next;
}

function notebookBasePrefix(tier = getWorkerTier()) {
  return tier === 'free' ? 'notebook_free' : 'notebook';
}

function notebookPrefix(tier = getWorkerTier()) {
  const acct = accountKeyPrefix();
  const base = notebookBasePrefix(tier);
  migrateLegacyNotebookKeysIfNeeded(acct, base);
  return `${acct}${base}`;
}

export function getNotebookSettings(tier = getWorkerTier()) {
  const prefix = notebookPrefix(tier);
  const fileId = getSetting(`${prefix}_file_id`);
  const url = getSetting(`${prefix}_url`);
  const name = getSetting(`${prefix}_name`);
  const isOwner = getSetting(`${prefix}_is_owner`) === 'true';
  const copied = getSetting(`${prefix}_copied`) === 'true';
  const manualCopyHint = getSetting(`${prefix}_manual_copy_hint`) === 'true';
  return {
    fileId,
    url,
    name,
    isOwner,
    copied,
    manualCopyHint,
    tier,
    ready: Boolean(fileId && url),
  };
}

export function saveNotebookSettings({
  fileId,
  url,
  name,
  isOwner = false,
  copied = true,
  manualCopyHint = false,
  tier = getWorkerTier(),
}) {
  const prefix = notebookPrefix(tier);
  setSetting(`${prefix}_file_id`, fileId);
  setSetting(`${prefix}_url`, url);
  if (name) setSetting(`${prefix}_name`, name);
  setSetting(`${prefix}_is_owner`, isOwner ? 'true' : 'false');
  setSetting(`${prefix}_copied`, copied ? 'true' : 'false');
  setSetting(`${prefix}_manual_copy_hint`, manualCopyHint ? 'true' : 'false');
  return getNotebookSettings(tier);
}

export function parseColabNotebookUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\./, '');
    if (host !== 'colab.research.google.com') return null;
    const driveMatch = url.pathname.match(/\/drive\/([a-zA-Z0-9_-]+)/);
    if (driveMatch) {
      const fileId = driveMatch[1];
      return {
        fileId,
        url: `https://colab.research.google.com/drive/${fileId}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function getWorkerTierInfo() {
  const tier = getWorkerTier();
  const generation = getGenerationSettings();
  if (tier === 'free') {
    return {
      tier: 'free',
      label: 'Free tier',
      resolution: `${generation.resolution}×${generation.resolution}`,
      accelerator: 'T4 GPU',
      highRam: false,
      notebookFile: 'notebooks/batch_worker_free.ipynb',
      detail:
        'Cheaper GPU (T4). Best way to stretch compute units. Free notebook caps output at 256×256.',
      generation,
    };
  }
  return {
    tier: 'pro',
    label: 'Pro tier',
    resolution: `${generation.resolution}×${generation.resolution}`,
    accelerator: 'A100 GPU',
    highRam: true,
    notebookFile: 'notebooks/batch_worker.ipynb',
    detail:
      'Faster/heavier GPU (A100). Pair with smaller output size and fewer steps below to spend fewer units per job.',
    generation,
  };
}

const STEP_PRESETS = [15, 20, 30];

export function getGenerationSettings() {
  const tier = getWorkerTier();
  const defaultRes = tier === 'free' ? '256' : '1024';
  const defaultSteps = tier === 'free' ? 20 : 30;
  let resolution = String(getSetting('gen_resolution', defaultRes) || defaultRes);
  if (resolution !== '256' && resolution !== '1024') resolution = defaultRes;
  // Free Colab worker cannot reliably run the 1024 upscaler.
  if (tier === 'free') resolution = '256';

  let steps = Number(getSetting('gen_steps', String(defaultSteps)));
  if (!Number.isFinite(steps)) steps = defaultSteps;
  steps = Math.max(5, Math.min(50, Math.round(steps)));

  return {
    resolution,
    num_inference_steps: steps,
    stepPresets: STEP_PRESETS,
    generate_1024: resolution === '1024',
  };
}

export function setGenerationSettings({ resolution, num_inference_steps } = {}) {
  const tier = getWorkerTier();
  if (resolution != null) {
    let next = String(resolution) === '1024' ? '1024' : '256';
    if (tier === 'free') next = '256';
    setSetting('gen_resolution', next);
  }
  if (num_inference_steps != null) {
    let steps = Number(num_inference_steps);
    if (!Number.isFinite(steps)) steps = tier === 'free' ? 20 : 30;
    steps = Math.max(5, Math.min(50, Math.round(steps)));
    setSetting('gen_steps', String(steps));
  }
  return getGenerationSettings();
}
