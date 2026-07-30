import db from '../db.js';

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

export function getNotebookSettings() {
  const fileId = getSetting('notebook_file_id');
  const url = getSetting('notebook_url');
  const name = getSetting('notebook_name');
  const isOwner = getSetting('notebook_is_owner') === 'true';
  const copied = getSetting('notebook_copied') === 'true';
  const manualCopyHint = getSetting('notebook_manual_copy_hint') === 'true';
  return {
    fileId,
    url,
    name,
    isOwner,
    copied,
    manualCopyHint,
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
}) {
  setSetting('notebook_file_id', fileId);
  setSetting('notebook_url', url);
  if (name) setSetting('notebook_name', name);
  setSetting('notebook_is_owner', isOwner ? 'true' : 'false');
  setSetting('notebook_copied', copied ? 'true' : 'false');
  setSetting('notebook_manual_copy_hint', manualCopyHint ? 'true' : 'false');
  return getNotebookSettings();
}