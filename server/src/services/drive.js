import fs from 'fs';
import http from 'http';
import path from 'path';
import { Readable } from 'stream';
import { google } from 'googleapis';
import { config } from '../config.js';
import {
  getActiveTokenPath,
  listAccounts,
  renameAccountId,
  updateAccountProfile,
  upsertAccountTokens,
} from './accounts.js';
import { remapJobsAccountId } from '../db.js';
import { getHuggingFaceToken, readOAuthClient } from './secrets.js';
import {
  remapFriendsSettingsAccount,
  remapNotebookSettingsAccount,
} from './settings.js';

// Per-file scope: only folders/files this app creates (or the user opens with it).
// Colab must overwrite those same files — see ensureJobResultPlaceholder().
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// Tiny valid 1×1 PNG so Colab can overwrite an app-created result file.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Real 1024×1024 results are ~1MB+; the app placeholder is ~70 bytes. */
export const MIN_RESULT_IMAGE_BYTES = config.minResultImageBytes;

let driveClient = null;
let folderIds = {
  queue: null,
  results: null,
  gallery: null,
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

export function getAuthUrl({ forceAccountPicker = false } = {}) {
  const oauth2Client = createOAuthClient();
  // select_account lets the user pick a different Google identity (needed for multi-account).
  const prompt = forceAccountPicker ? 'select_account consent' : 'consent';
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt,
  });
}

/**
 * Exchange an OAuth code, identify the Google user, and store tokens under that account profile.
 */
export async function exchangeCode(code) {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  driveClient = google.drive({ version: 'v3', auth: oauth2Client });

  const profile = await fetchDriveUserProfile(driveClient);
  const accountId = profile.id;
  const before = listAccounts();
  // Only fold the migrated placeholder when it is the account being upgraded — never when adding a second login.
  const foldLegacy =
    before.accounts.some((a) => a.id === 'legacy') &&
    (before.activeAccountId === 'legacy' ||
      before.accounts.every((a) => a.id === 'legacy'));

  const { account, isNew } = upsertAccountTokens({
    id: accountId,
    email: profile.email,
    displayName: profile.displayName,
    tokens,
  });

  if (foldLegacy && accountId !== 'legacy') {
    renameAccountId('legacy', accountId, {
      email: profile.email,
      displayName: profile.displayName,
    });
    remapJobsAccountId('legacy', accountId);
    remapNotebookSettingsAccount('legacy', accountId);
    remapFriendsSettingsAccount('legacy', accountId);
  }

  return { tokens, account, isNew, profile };
}

async function fetchDriveUserProfile(drive) {
  const about = await drive.about.get({
    fields: 'user(displayName,emailAddress,permissionId)',
  });
  const user = about.data.user || {};
  const email = user.emailAddress || null;
  const permissionId = user.permissionId || null;
  const id =
    permissionId ||
    (email ? `email:${email.toLowerCase()}` : `anon_${Date.now()}`);
  return {
    id,
    email,
    displayName: user.displayName || email || 'Google account',
  };
}

/** Refresh email/name for the active account (e.g. after legacy migration). */
export async function refreshActiveAccountProfile() {
  if (!isAuthenticated()) return null;
  const drive = await getAuthorizedClient();
  const profile = await fetchDriveUserProfile(drive);
  const listed = listAccounts();
  if (listed.activeAccountId === 'legacy' && profile.id !== 'legacy') {
    renameAccountId('legacy', profile.id, {
      email: profile.email,
      displayName: profile.displayName,
    });
    remapJobsAccountId('legacy', profile.id);
    remapNotebookSettingsAccount('legacy', profile.id);
    remapFriendsSettingsAccount('legacy', profile.id);
  } else if (listed.activeAccountId) {
    updateAccountProfile(listed.activeAccountId, {
      email: profile.email,
      displayName: profile.displayName,
    });
  }
  return profile;
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
  folderIds = { queue: null, results: null, gallery: null };
}

export function getFolderIds() {
  return { ...folderIds };
}

export function isAuthenticated() {
  return fs.existsSync(getActiveTokenPath()) || fs.existsSync(config.tokenPath);
}

export async function getAuthorizedClient({ allowInteractive = false } = {}) {
  if (driveClient) return driveClient;

  const oauth2Client = createOAuthClient();
  const tokenPath = getActiveTokenPath();

  if (fs.existsSync(tokenPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    oauth2Client.setCredentials(token);
  } else if (allowInteractive) {
    const code = await waitForAuthCode(oauth2Client);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    driveClient = google.drive({ version: 'v3', auth: oauth2Client });
    const profile = await fetchDriveUserProfile(driveClient);
    upsertAccountTokens({
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      tokens,
    });
    console.log(`Saved token for ${profile.email || profile.id}`);
    return driveClient;
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

export async function ensureFolder(drive, name, parentId = null) {
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
  folderIds.gallery = await ensureFolder(drive, config.driveGalleryFolder);

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

  const galleryManifest = await findFileInFolder(
    drive,
    config.galleryManifestFilename,
    folderIds.gallery
  );
  if (!galleryManifest) {
    await writeJsonFile(config.galleryManifestFilename, folderIds.gallery, {
      version: 1,
      owner: null,
      updated_at: null,
      items: [],
    });
  }

  return { ...folderIds };
}

export async function findFileInFolder(drive, name, folderId) {
  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, modifiedTime, size)',
    pageSize: 1,
  });
  return res.data.files?.[0] || null;
}

export async function readJsonFile(name, folderId) {
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

export async function writeJsonFile(name, folderId, data) {
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

/** Make an app-owned file readable by anyone with the link. */
export async function setAnyoneWithLink(fileId) {
  if (!fileId) return false;
  const drive = await getAuthorizedClient();
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        type: 'anyone',
        role: 'reader',
      },
    });
    return true;
  } catch (err) {
    const message = String(err?.message || '');
    // Already public, or a duplicate permission — treat as success.
    if (
      err?.code === 400 ||
      /already exists/i.test(message) ||
      /duplicate/i.test(message)
    ) {
      return true;
    }
    throw err;
  }
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
  const placeholder = await ensureJobResultPlaceholder(job.id);
  const enriched = {
    ...job,
    result_folder_id: placeholder.folderId,
    result_file_id: placeholder.fileId,
  };

  const queue = await readJobQueue();
  const idx = queue.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) {
    queue.jobs[idx] = { ...queue.jobs[idx], ...enriched };
  } else {
    queue.jobs.push(enriched);
  }
  await writeJobQueue(queue.jobs);
  return enriched;
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

  // Colab mount writes can create a second folder with the same job id; scan all.
  const folders = await drive.files.list({
    q: [
      `name='${jobId.replace(/'/g, "\\'")}'`,
      `mimeType='application/vnd.google-apps.folder'`,
      `'${folderIds.results}' in parents`,
      'trashed=false',
    ].join(' and '),
    fields: 'files(id, name)',
    pageSize: 20,
  });
  let jobFolders = folders.data.files || [];
  if (jobFolders.length === 0) {
    const legacy = await findFolderId(drive, jobId, folderIds.results);
    if (legacy) jobFolders = [{ id: legacy, name: jobId }];
  }

  let best = null;
  for (const jobFolder of jobFolders) {
    for (const name of ['image_1024.png', 'sample_1024.png', 'sample_256.png', 'image_256.png']) {
      const file = await findFileInFolder(drive, name, jobFolder.id);
      if (!file) continue;

      const size = Number(file.size || 0);
      // Still the app-created 1×1 placeholder — Colab hasn't flushed the real PNG yet.
      if (size > 0 && size < MIN_RESULT_IMAGE_BYTES) {
        continue;
      }

      const candidate = {
        fileId: file.id,
        name,
        folderId: jobFolder.id,
        size,
        modifiedTime: file.modifiedTime || null,
      };
      if (!best || candidate.size > best.size) best = candidate;
    }
  }
  return best;
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
    tokenPresent: isAuthenticated(),
  };
}