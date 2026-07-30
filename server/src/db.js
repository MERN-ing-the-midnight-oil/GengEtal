import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

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

export function createJob({ id, prompt_1, prompt_2, status, created_at, updated_at }) {
  const stmt = db.prepare(`
    INSERT INTO jobs (id, prompt_1, prompt_2, status, created_at, updated_at)
    VALUES (@id, @prompt_1, @prompt_2, @status, @created_at, @updated_at)
  `);
  stmt.run({ id, prompt_1, prompt_2, status, created_at, updated_at });
  return getJob(id);
}

export function getJob(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) || null;
}

export function getAllJobs({ status, q } = {}) {
  let sql = 'SELECT * FROM jobs WHERE 1=1';
  const params = [];

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
  if (!existing) {
    db.prepare(`
      INSERT INTO jobs (
        id, prompt_1, prompt_2, status, created_at, updated_at,
        completed_at, error_message, image_path
      ) VALUES (
        @id, @prompt_1, @prompt_2, @status, @created_at, @updated_at,
        @completed_at, @error_message, @image_path
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
    });
    return getJob(job.id);
  }

  return updateJob(job.id, {
    status: job.status,
    updated_at: job.updated_at || existing.updated_at,
    completed_at: job.completed_at ?? existing.completed_at,
    error_message: job.error_message ?? existing.error_message,
    image_path: job.image_path ?? existing.image_path,
  });
}

export function toPublicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    prompt_1: job.prompt_1,
    prompt_2: job.prompt_2,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
    error_message: job.error_message,
    has_image: Boolean(job.local_image_path),
    image_url: job.local_image_path ? `/api/jobs/${job.id}/image` : null,
  };
}

export default db;