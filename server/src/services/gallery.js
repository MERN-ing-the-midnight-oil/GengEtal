import fs from 'fs';
import { config } from '../config.js';
import { getActiveAccount } from './accounts.js';
import {
  ensureDriveLayout,
  findFileInFolder,
  getAuthorizedClient,
  getFolderIds,
  readJsonFile,
  setAnyoneWithLink,
  writeJsonFile,
} from './drive.js';

function emptyManifest(owner = null) {
  return {
    version: 1,
    owner,
    updated_at: null,
    items: [],
  };
}

function ownerFromAccount(account) {
  if (!account) return null;
  return {
    id: account.id || null,
    email: account.email || null,
    displayName: account.displayName || account.email || null,
  };
}

async function ensureGalleryPublic(folderId, manifestFileId) {
  await setAnyoneWithLink(folderId);
  if (manifestFileId) await setAnyoneWithLink(manifestFileId);
}

export async function ensureGalleryReady() {
  const folders = await ensureDriveLayout();
  const file = await readJsonFile(
    config.galleryManifestFilename,
    folders.gallery
  );
  const account = getActiveAccount();
  const owner = ownerFromAccount(account);
  let data = file?.data && typeof file.data === 'object' ? file.data : emptyManifest(owner);
  if (!Array.isArray(data.items)) data.items = [];
  data.version = 1;
  if (owner) data.owner = owner;

  const manifestFileId = await writeJsonFile(
    config.galleryManifestFilename,
    folders.gallery,
    data
  );
  await ensureGalleryPublic(folders.gallery, manifestFileId);

  return {
    folderId: folders.gallery,
    manifestFileId,
    manifest: data,
  };
}

export async function getMyGalleryShareInfo() {
  const { folderId, manifestFileId, manifest } = await ensureGalleryReady();
  return {
    folderId,
    manifestFileId,
    folderUrl: `https://drive.google.com/drive/folders/${folderId}?usp=sharing`,
    galleryLink: `https://drive.google.com/file/d/${manifestFileId}/view?usp=sharing`,
    owner: manifest.owner || ownerFromAccount(getActiveAccount()),
    itemCount: manifest.items?.length || 0,
  };
}

async function readOwnManifest() {
  const folders = await ensureDriveLayout();
  const file = await readJsonFile(
    config.galleryManifestFilename,
    folders.gallery
  );
  const account = getActiveAccount();
  const owner = ownerFromAccount(account);
  if (!file) {
    return {
      folderId: folders.gallery,
      manifestFileId: null,
      data: emptyManifest(owner),
    };
  }
  const data =
    file.data && typeof file.data === 'object'
      ? file.data
      : emptyManifest(owner);
  if (!Array.isArray(data.items)) data.items = [];
  if (owner) data.owner = owner;
  return {
    folderId: folders.gallery,
    manifestFileId: file.id,
    data,
  };
}

async function saveOwnManifest(data) {
  const folders = getFolderIds();
  const galleryId = folders.gallery || (await ensureDriveLayout()).gallery;
  data.updated_at = new Date().toISOString();
  data.version = 1;
  const manifestFileId = await writeJsonFile(
    config.galleryManifestFilename,
    galleryId,
    data
  );
  await ensureGalleryPublic(galleryId, manifestFileId);
  return manifestFileId;
}

async function uploadGalleryImage(jobId, localImagePath) {
  const drive = await getAuthorizedClient();
  const folders = getFolderIds();
  const galleryId = folders.gallery || (await ensureDriveLayout()).gallery;
  const name = `${jobId}.png`;
  const existing = await findFileInFolder(drive, name, galleryId);
  const body = fs.createReadStream(localImagePath);

  if (existing) {
    await drive.files.update({
      fileId: existing.id,
      media: {
        mimeType: 'image/png',
        body,
      },
    });
    await setAnyoneWithLink(existing.id);
    return existing.id;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      parents: [galleryId],
    },
    media: {
      mimeType: 'image/png',
      body,
    },
    fields: 'id',
  });
  await setAnyoneWithLink(created.data.id);
  return created.data.id;
}

async function deleteGalleryImage(jobId, fileId) {
  const drive = await getAuthorizedClient();
  const folders = await ensureDriveLayout();
  const name = `${jobId}.png`;

  const ids = new Set();
  if (fileId) ids.add(fileId);
  const existing = await findFileInFolder(drive, name, folders.gallery);
  if (existing?.id) ids.add(existing.id);

  for (const id of ids) {
    try {
      await drive.files.delete({ fileId: id });
    } catch (err) {
      console.warn('Failed to delete gallery image:', err.message);
    }
  }
}

/**
 * Copy a completed local result into the public gallery folder and update the manifest.
 */
export async function publishJobToGallery(job) {
  if (!job?.id) throw new Error('Job is required');
  if (job.status !== 'completed') {
    throw new Error('Only completed jobs can be published');
  }
  if (!job.local_image_path || !fs.existsSync(job.local_image_path)) {
    throw new Error('Image is not available locally yet');
  }
  const size = fs.statSync(job.local_image_path).size;
  if (size < config.minResultImageBytes) {
    throw new Error('Image is not available locally yet');
  }

  await ensureGalleryReady();
  const fileId = await uploadGalleryImage(job.id, job.local_image_path);
  const { data } = await readOwnManifest();
  const publishedAt = new Date().toISOString();
  const entry = {
    job_id: job.id,
    prompt_1: job.prompt_1,
    prompt_2: job.prompt_2,
    file_id: fileId,
    published_at: publishedAt,
    completed_at: job.completed_at || publishedAt,
  };
  const idx = data.items.findIndex((item) => item.job_id === job.id);
  if (idx >= 0) data.items[idx] = entry;
  else data.items.unshift(entry);

  await saveOwnManifest(data);
  return { fileId, entry, share: await getMyGalleryShareInfo() };
}

export async function unpublishJobFromGallery(jobId) {
  if (!jobId) throw new Error('Job id is required');
  const { data } = await readOwnManifest();
  const existing = data.items.find((item) => item.job_id === jobId);
  data.items = data.items.filter((item) => item.job_id !== jobId);
  await saveOwnManifest(data);
  await deleteGalleryImage(jobId, existing?.file_id || null);
  return { ok: true, share: await getMyGalleryShareInfo() };
}

/** Extract a Drive file id from a pasted gallery / file URL or raw id. */
export function parseGalleryLink(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  // Google Drive file ids are typically 25+ chars.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) {
    return { manifestFileId: text };
  }

  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'drive.google.com' || host === 'docs.google.com') {
      const fileMatch = url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (fileMatch) return { manifestFileId: fileMatch[1] };
      const openMatch = url.searchParams.get('id');
      if (openMatch) return { manifestFileId: openMatch };
      const folderMatch = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
      if (folderMatch) {
        return {
          folderId: folderMatch[1],
          error:
            'Paste the gallery manifest link (Copy gallery link), not the folder URL.',
        };
      }
    }
  } catch {
    // fall through
  }

  return null;
}
