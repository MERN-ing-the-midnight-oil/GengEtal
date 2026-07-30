import fs from 'fs';
import http from 'http';
import path from 'path';
import { Readable } from 'stream';
import { google } from 'googleapis';
import { config } from '../config.js';
import { getHuggingFaceToken, readOAuthClient } from './secrets.js';

// Per-file scope: only folders/files this app creates (or the user opens with it).
// Colab must overwrite those same files — see ensureJobResultPlaceholder().
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// Tiny valid 1×1 PNG so Colab can overwrite an app-created result file.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let driveClient = null;
let folderIds = {
  queue: null,
  results: null,
};

function loadCredentials() {
  const client = readOAuthClient();
  if (!client) {
    throw new Error(
      'Google OAuth client not configured. Enter Client ID and Secret in the app setup screen.'
    );
  }
  return {
    client_id: client.client_id,
    client_secret: client.client_secret,
  };
}

export function createOAuthClient() {
  const creds = loadCredentials();
  return new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    config.oauthRedirectUri
  );
}

export function getAuthUrl() {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function exchangeCode(code) {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.mkdirSync(path.dirname(config.tokenPath), { recursive: true });
  fs.writeFileSync(config.tokenPath, JSON.stringify(tokens, null, 2));
  driveClient = google.drive({ version: 'v3', auth: oauth2Client });
  return tokens;
}

async function waitForAuthCode(oauth2Client) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\nAuthorize this app by visiting:\n');
  console.log(authUrl);
  console.log('\nWaiting for OAuth callback...\n');

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${config.oauthRedirectPort}`);
        if (url.pathname !== '/oauth2callback' && url.pathname !== '/api/setup/auth/google/callback') {
          res.writeHead(404);
          res.end();
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400);
          res.end('Missing code');
          reject(new Error('OAuth callback missing code'));
          server.close();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization complete</h1><p>You can close this tab.</p>');
        server.close();
        resolve(code);
      } catch (err) {
        reject(err);
        server.close();
      }
    });

    server.listen(config.oauthRedirectPort, '127.0.0.1');
  });
}

export function resetDriveClient() {
  driveClient = null;
  folderIds = { queue: null, results: null };
}

export function isAuthenticated() {
  return fs.existsSync(config.tokenPath);
}

export async function getAuthorizedClient({ allowInteractive = false } = {}) {
  if (driveClient) return driveClient;

  const oauth2Client = createOAuthClient();

  if (fs.existsSync(config.tokenPath)) {
    const token = JSON.parse(fs.readFileSync(config.tokenPath, 'utf8'));
    oauth2Client.setCredentials(token);
  } else if (allowInteractive) {
    const code = await waitForAuthCode(oauth2Client);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    fs.mkdirSync(path.dirname(config.tokenPath), { recursive: true });
    fs.writeFileSync(config.tokenPath, JSON.stringify(tokens, null, 2));
    console.log(`Saved token to ${config.tokenPath}`);
  } else {
    throw new Error('Not signed in with Google. Visit /api/setup/auth/google to authenticate.');
  }

  driveClient = google.drive({ version: 'v3', auth: oauth2Client });
  return driveClient;
}

async function findFolderId(drive, name, parentId = null) {
  const parts = [
    `name='${name.replace(/'/g, "\\'")}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    'trashed=false',
  ];
  if (parentId) parts.push(`'${parentId}' in parents`);
  const res = await drive.files.list({
    q: parts.join(' and '),
    fields: 'files(id, name)',
    spaces: 'drive',
    pageSize: 1,
  });
  return res.data.files?.[0]?.id || null;
}

async function ensureFolder(drive, name, parentId = null) {
  const existing = await findFolderId(drive, name, parentId);
  if (existing) return existing;

  const meta = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) meta.parents = [parentId];

  const created = await drive.files.create({
    requestBody: meta,
    fields: 'id',
  });
  return created.data.id;
}

export async function ensureDriveLayout() {
  const drive = await getAuthorizedClient();
  folderIds.queue = await ensureFolder(drive, config.driveQueueFolder);
  folderIds.results = await ensureFolder(drive, config.driveResultsFolder);

  // Pre-create JSON files so Colab can update them under drive.file scope
  const queueFile = await findFileInFolder(drive, config.jobQueueFilename, folderIds.queue);
  if (!queueFile) {
    await writeJsonFile(config.jobQueueFilename, folderIds.queue, { jobs: [] });
  }

  const heartbeat = await findFileInFolder(drive, config.heartbeatFilename, folderIds.queue);
  if (!heartbeat) {
    await writeJsonFile(config.heartbeatFilename, folderIds.queue, {
      last_seen: null,
      status: 'offline',
    });
  }

  const secrets = await findFileInFolder(drive, config.driveSecretsFilename, folderIds.queue);
  if (!secrets) {
    await writeJsonFile(config.driveSecretsFilename, folderIds.queue, {
      huggingface_token: null,
      updated_at: null,
    });
  }

  return { ...folderIds };
}

async function findFileInFolder(drive, name, folderId) {
  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, modifiedTime)',
    pageSize: 1,
  });
  return res.data.files?.[0] || null;
}

async function readJsonFile(name, folderId) {
  const drive = await getAuthorizedClient();
  const file = await findFileInFolder(drive, name, folderId);
  if (!file) return null;

  const res = await drive.files.get(
    { fileId: file.id, alt: 'media' },
    { responseType: 'text' }
  );
  return {
    id: file.id,
    data: JSON.parse(res.data),
    modifiedTime: file.modifiedTime,
  };
}

async function writeJsonFile(name, folderId, data) {
  const drive = await getAuthorizedClient();
  const existing = await findFileInFolder(drive, name, folderId);
  const body = JSON.stringify(data, null, 2);

  if (existing) {
    await drive.files.update({
      fileId: existing.id,
      media: {
        mimeType: 'application/json',
        body,
      },
    });
    return existing.id;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/json',
      body,
    },
    fields: 'id',
  });
  return created.data.id;
}

/** Write HF token (and related secrets) for the Colab notebook to read. */
export async function syncSecretsToDrive() {
  const token = getHuggingFaceToken();
  if (!token) {
    throw new Error('No Hugging Face token saved yet');
  }
  await ensureDriveLayout();
  await writeJsonFile(config.driveSecretsFilename, folderIds.queue, {
    huggingface_token: token,
    updated_at: new Date().toISOString(),
  });
  return true;
}

export async function readJobQueue() {
  await ensureDriveLayout();
  const file = await readJsonFile(config.jobQueueFilename, folderIds.queue);
  if (!file) return { jobs: [] };
  if (Array.isArray(file.data)) return { jobs: file.data };
  return { jobs: file.data.jobs || [] };
}

export async function writeJobQueue(jobs) {
  await ensureDriveLayout();
  await writeJsonFile(config.jobQueueFilename, folderIds.queue, { jobs });
}

/**
 * Create the per-job result folder + placeholder PNG so Colab can overwrite
 * an app-owned file (required for drive.file scope).
 */
export async function ensureJobResultPlaceholder(jobId) {
  const drive = await getAuthorizedClient();
  await ensureDriveLayout();

  const jobFolderId = await ensureFolder(drive, jobId, folderIds.results);
  const existing = await findFileInFolder(drive, 'image_1024.png', jobFolderId);
  if (existing) {
    return { folderId: jobFolderId, fileId: existing.id };
  }

  const created = await drive.files.create({
    requestBody: {
      name: 'image_1024.png',
      parents: [jobFolderId],
    },
    media: {
      mimeType: 'image/png',
      body: Readable.from(PLACEHOLDER_PNG),
    },
    fields: 'id',
  });

  return { folderId: jobFolderId, fileId: created.data.id };
}

export async function appendJobToQueue(job) {
  const queue = await readJobQueue();
  const idx = queue.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) {
    queue.jobs[idx] = job;
  } else {
    queue.jobs.push(job);
  }
  await writeJobQueue(queue.jobs);
  await ensureJobResultPlaceholder(job.id);
  return job;
}

export async function removeJobFromQueue(jobId) {
  const queue = await readJobQueue();
  const next = queue.jobs.filter((j) => j.id !== jobId);
  if (next.length === queue.jobs.length) return false;
  await writeJobQueue(next);
  return true;
}

export async function readHeartbeat() {
  try {
    await ensureDriveLayout();
    const file = await readJsonFile(config.heartbeatFilename, folderIds.queue);
    return file?.data || null;
  } catch {
    return null;
  }
}

export async function findResultImage(jobId) {
  const drive = await getAuthorizedClient();
  await ensureDriveLayout();

  const jobFolder = await findFolderId(drive, jobId, folderIds.results);
  if (!jobFolder) return null;

  for (const name of ['image_1024.png', 'sample_1024.png']) {
    const file = await findFileInFolder(drive, name, jobFolder);
    if (file) {
      return { fileId: file.id, name, folderId: jobFolder };
    }
  }
  return null;
}

export async function downloadFile(fileId, destPath) {
  const drive = await getAuthorizedClient();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  await new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(destPath);
    res.data
      .on('error', reject)
      .pipe(dest)
      .on('error', reject)
      .on('finish', resolve);
  });

  return destPath;
}

/**
 * Resolve the Colab notebook URL.
 * Under drive.file we often cannot read/copy an existing shared notebook via the
 * Drive API, so we fall back to the shared Colab link (users can File → Save a copy).
 */
export async function ensureUserNotebook() {
  const templateId = config.templateNotebookId;
  const fallback = {
    fileId: templateId,
    url: `https://colab.research.google.com/drive/${templateId}`,
    name: config.templateNotebookCopyName,
    isOwner: false,
    copied: false,
    manualCopyHint: true,
  };

  try {
    const drive = await getAuthorizedClient();
    const meta = await drive.files.get({
      fileId: templateId,
      fields: 'id, name, ownedByMe',
    });

    if (meta.data.ownedByMe) {
      return {
        fileId: meta.data.id,
        url: `https://colab.research.google.com/drive/${meta.data.id}`,
        name: meta.data.name || config.templateNotebookCopyName,
        isOwner: true,
        copied: false,
        manualCopyHint: false,
      };
    }

    const copied = await drive.files.copy({
      fileId: templateId,
      requestBody: {
        name: config.templateNotebookCopyName,
      },
      fields: 'id, name',
    });

    return {
      fileId: copied.data.id,
      url: `https://colab.research.google.com/drive/${copied.data.id}`,
      name: copied.data.name || config.templateNotebookCopyName,
      isOwner: false,
      copied: true,
      manualCopyHint: false,
    };
  } catch (err) {
    console.warn(
      'Notebook Drive API access unavailable under drive.file; using shared Colab link:',
      err.message
    );
    return fallback;
  }
}

export function isDriveConfigured() {
  return Boolean(readOAuthClient());
}

export function getDriveAuthStatus() {
  return {
    credentialsPresent: isDriveConfigured(),
    tokenPresent: fs.existsSync(config.tokenPath),
  };
}