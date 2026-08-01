import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { getActiveAccountId } from './services/accounts.js';

const MIN_RESULT_IMAGE_BYTES = config.minResultImageBytes;

fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });

const db = new Database(config.sqlitePath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    prompt_1 TEXT NOT NULL,
    prompt_2 TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    error_message TEXT,
    image_path TEXT,
    local_image_path TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
`);

const jobColumns = db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
if (!jobColumns.includes('google_account_id')) {
  db.exec('ALTER TABLE jobs ADD COLUMN google_account_id TEXT');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_jobs_google_account_id ON jobs(google_account_id)'
  );
}
if (!jobColumns.includes('published')) {
  db.exec('ALTER TABLE jobs ADD COLUMN published INTEGER NOT NULL DEFAULT 0');
}
if (!jobColumns.includes('gallery_file_id')) {
  db.exec('ALTER TABLE jobs ADD COLUMN gallery_file_id TEXT');
}

/** Stamp legacy rows (null account) onto the current Google identity once. */
export function assignNullJobsToAccount(accountId) {
  if (!accountId) return 0;
  const result = db
    .prepare(
      `UPDATE jobs SET google_account_id = ? WHERE google_account_id IS NULL OR google_account_id = ''`
    )
    .run(accountId);
  return result.changes || 0;
}

export function remapJobsAccountId(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return 0;
  const result = db
    .prepare('UPDATE jobs SET google_account_id = ? WHERE google_account_id = ?')
    .run(toId, fromId);
  return result.changes || 0;
}

const activeAccountId = getActiveAccountId();
if (activeAccountId) {
  assignNullJobsToAccount(activeAccountId);
}

export function createJob({
  id,
  prompt_1,
  prompt_2,
  status,
  created_at,
  updated_at,
  google_account_id = null,
}) {
  const accountId = google_account_id || getActiveAccountId() || null;
  const stmt = db.prepare(`
    INSERT INTO jobs (id, prompt_1, prompt_2, status, created_at, updated_at, google_account_id)
    VALUES (@id, @prompt_1, @prompt_2, @status, @created_at, @updated_at, @google_account_id)
  `);
  stmt.run({
    id,
    prompt_1,
    prompt_2,
    status,
    created_at,
    updated_at,
    google_account_id: accountId,
  });
  return getJob(id);
}

export function getJob(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) || null;
}

export function getAllJobs({ status, q, googleAccountId } = {}) {
  let sql = 'SELECT * FROM jobs WHERE 1=1';
  const params = [];

  const accountId =
    googleAccountId === undefined ? getActiveAccountId() : googleAccountId;
  if (accountId) {
    sql += ' AND google_account_id = ?';
    params.push(accountId);
  }

  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }

  if (q && q.trim()) {
    sql += ' AND (prompt_1 LIKE ? OR prompt_2 LIKE ? OR id LIKE ?)';
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }

  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params);
}

export function updateJob(id, fields) {
  const allowed = [
    'status',
    'updated_at',
    'completed_at',
    'error_message',
    'image_path',
    'local_image_path',
    'published',
    'gallery_file_id',
  ];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return getJob(id);

  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE jobs SET ${sets} WHERE id = @id`).run({ id, ...fields });
  return getJob(id);
}

export function deleteJob(id) {
  const job = getJob(id);
  if (!job) return null;
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  return job;
}

export function upsertJobFromRemote(job) {
  const existing = getJob(job.id);
  const accountId = job.google_account_id || getActiveAccountId() || null;
  if (!existing) {
    db.prepare(`
      INSERT INTO jobs (
        id, prompt_1, prompt_2, status, created_at, updated_at,
        completed_at, error_message, image_path, google_account_id
      ) VALUES (
        @id, @prompt_1, @prompt_2, @status, @created_at, @updated_at,
        @completed_at, @error_message, @image_path, @google_account_id
      )
    `).run({
      id: job.id,
      prompt_1: job.prompt_1,
      prompt_2: job.prompt_2,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at || job.created_at,
      completed_at: job.completed_at || null,
      error_message: job.error_message || null,
      image_path: job.image_path || null,
      google_account_id: accountId,
    });
    return getJob(job.id);
  }

  if (!existing.google_account_id && accountId) {
    db.prepare('UPDATE jobs SET google_account_id = ? WHERE id = ?').run(
      accountId,
      job.id
    );
  }

  return updateJob(job.id, {
    status: job.status,
    updated_at: job.updated_at || existing.updated_at,
    completed_at: job.completed_at ?? existing.completed_at,
    error_message: job.error_message ?? existing.error_message,
    image_path: job.image_path ?? existing.image_path,
  });
}

function hasRealLocalImage(job) {
  if (!job?.local_image_path) return false;
  try {
    return fs.statSync(job.local_image_path).size >= MIN_RESULT_IMAGE_BYTES;
  } catch {
    return false;
  }
}

export function toPublicJob(job) {
  if (!job) return null;
  const ready = hasRealLocalImage(job);
  return {
    id: job.id,
    prompt_1: job.prompt_1,
    prompt_2: job.prompt_2,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
    error_message: job.error_message,
    has_image: ready,
    image_url: ready ? `/api/jobs/${job.id}/image` : null,
    published: Boolean(job.published),
  };
}

export default db;