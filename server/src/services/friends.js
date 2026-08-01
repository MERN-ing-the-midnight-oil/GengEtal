import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getActiveAccountId } from './accounts.js';
import { getSetting, setSetting } from './settings.js';
import { parseGalleryLink } from './gallery.js';

function accountKeyPrefix() {
  const id = getActiveAccountId();
  if (!id) return '';
  const safe = String(id).replace(/[^a-zA-Z0-9:_-]/g, '_');
  return `acct_${safe}__`;
}

function friendsSettingKey() {
  return `${accountKeyPrefix()}friends`;
}

function readFriends() {
  const raw = getSetting(friendsSettingKey(), '[]');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFriends(friends) {
  setSetting(friendsSettingKey(), JSON.stringify(friends));
  return friends;
}

export function listFriends() {
  return readFriends().sort((a, b) =>
    String(a.displayName || a.email || '').localeCompare(
      String(b.displayName || b.email || '')
    )
  );
}

export function getFriend(friendId) {
  return readFriends().find((f) => f.id === friendId) || null;
}

/**
 * Download a publicly shared Drive file ("anyone with the link") without needing
 * drive.file access to the owner's Drive.
 */
export async function downloadPublicDriveFile(fileId, destPath) {
  if (!fileId) throw new Error('fileId is required');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  let res = await fetch(url, { redirect: 'follow' });
  let buffer = Buffer.from(await res.arrayBuffer());
  const contentType = String(res.headers.get('content-type') || '');

  // Large files sometimes return an HTML confirm interstitial.
  if (contentType.includes('text/html')) {
    const html = buffer.toString('utf8');
    const confirm =
      html.match(/confirm=([0-9A-Za-z_]+)/)?.[1] ||
      html.match(/name="confirm" value="([^"]+)"/)?.[1];
    if (confirm) {
      const confirmUrl = `https://drive.google.com/uc?export=download&confirm=${encodeURIComponent(confirm)}&id=${encodeURIComponent(fileId)}`;
      res = await fetch(confirmUrl, { redirect: 'follow' });
      buffer = Buffer.from(await res.arrayBuffer());
    } else {
      throw new Error(
        'Could not download public Drive file. Make sure the gallery link is set to “Anyone with the link”.'
      );
    }
  }

  if (!res.ok) {
    throw new Error(
      `Public Drive download failed (${res.status}). Is the gallery link shared as “Anyone with the link”?`
    );
  }

  if (buffer.length < 2) {
    throw new Error('Downloaded file was empty');
  }

  fs.writeFileSync(destPath, buffer);
  return destPath;
}

async function fetchPublicJson(fileId) {
  const tmp = path.join(
    config.friendsCacheDir,
    `_tmp_${fileId}_${Date.now()}.json`
  );
  try {
    await downloadPublicDriveFile(fileId, tmp);
    const text = fs.readFileSync(tmp, 'utf8');
    return JSON.parse(text);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function friendIdFromManifest(manifest, manifestFileId) {
  const ownerId = manifest?.owner?.id;
  if (ownerId) return String(ownerId);
  const email = manifest?.owner?.email;
  if (email) return `email:${String(email).toLowerCase()}`;
  return `manifest:${manifestFileId}`;
}

export async function addFriendFromGalleryLink(rawLink) {
  const parsed = parseGalleryLink(rawLink);
  if (!parsed?.manifestFileId) {
    throw new Error(
      parsed?.error ||
        'Paste a gallery link from your friend’s app (Copy gallery link).'
    );
  }
  if (parsed.error) throw new Error(parsed.error);

  const manifest = await fetchPublicJson(parsed.manifestFileId);
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Gallery manifest was empty or unreadable');
  }

  const id = friendIdFromManifest(manifest, parsed.manifestFileId);
  const activeId = getActiveAccountId();
  if (activeId && id === activeId) {
    throw new Error('That gallery belongs to your current Google account');
  }

  const friends = readFriends();
  const existingIdx = friends.findIndex(
    (f) => f.id === id || f.manifestFileId === parsed.manifestFileId
  );
  const entry = {
    id,
    email: manifest.owner?.email || null,
    displayName:
      manifest.owner?.displayName ||
      manifest.owner?.email ||
      'Friend gallery',
    manifestFileId: parsed.manifestFileId,
    addedAt:
      existingIdx >= 0
        ? friends[existingIdx].addedAt
        : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) friends[existingIdx] = { ...friends[existingIdx], ...entry };
  else friends.push(entry);

  writeFriends(friends);
  return entry;
}

export function removeFriend(friendId) {
  const friends = readFriends();
  const next = friends.filter((f) => f.id !== friendId);
  if (next.length === friends.length) return null;
  writeFriends(next);

  const cacheDir = path.join(config.friendsCacheDir, safePathSegment(friendId));
  try {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  return { ok: true, id: friendId };
}

function safePathSegment(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function fetchFriendManifest(friend) {
  if (!friend?.manifestFileId) throw new Error('Friend has no gallery link');
  const manifest = await fetchPublicJson(friend.manifestFileId);
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  return {
    friend: {
      id: friend.id,
      email: manifest?.owner?.email || friend.email,
      displayName:
        manifest?.owner?.displayName ||
        friend.displayName ||
        friend.email ||
        'Friend',
    },
    updated_at: manifest?.updated_at || null,
    items: items.map((item) => ({
      id: item.job_id,
      job_id: item.job_id,
      prompt_1: item.prompt_1,
      prompt_2: item.prompt_2,
      file_id: item.file_id,
      published_at: item.published_at || null,
      completed_at: item.completed_at || item.published_at || null,
      status: 'completed',
      has_image: Boolean(item.file_id),
      image_url: item.file_id
        ? `/api/friends/${encodeURIComponent(friend.id)}/images/${encodeURIComponent(item.job_id)}`
        : null,
      friend_id: friend.id,
      friend_label:
        manifest?.owner?.displayName ||
        friend.displayName ||
        friend.email ||
        'Friend',
    })),
  };
}

export async function getFriendGallery(friendId) {
  const friend = getFriend(friendId);
  if (!friend) throw new Error('Friend not found');
  return fetchFriendManifest(friend);
}

export async function getAllFriendsGalleries() {
  const friends = listFriends();
  const results = [];
  const errors = [];

  for (const friend of friends) {
    try {
      const gallery = await fetchFriendManifest(friend);
      results.push(gallery);
    } catch (err) {
      errors.push({
        friendId: friend.id,
        email: friend.email,
        error: err.message,
      });
    }
  }

  const items = results
    .flatMap((g) => g.items)
    .sort((a, b) =>
      String(b.published_at || b.completed_at || '').localeCompare(
        String(a.published_at || a.completed_at || '')
      )
    );

  return { friends: listFriends(), items, errors };
}

export async function ensureFriendImage(friendId, jobId) {
  const gallery = await getFriendGallery(friendId);
  const item = gallery.items.find((i) => i.job_id === jobId || i.id === jobId);
  if (!item?.file_id) throw new Error('Image not found in friend gallery');

  const dest = path.join(
    config.friendsCacheDir,
    safePathSegment(friendId),
    `${safePathSegment(jobId)}.png`
  );

  if (fs.existsSync(dest)) {
    try {
      if (fs.statSync(dest).size >= config.minResultImageBytes) {
        return dest;
      }
    } catch {
      // re-download
    }
  }

  await downloadPublicDriveFile(item.file_id, dest);
  if (fs.statSync(dest).size < config.minResultImageBytes) {
    try {
      fs.unlinkSync(dest);
    } catch {
      // ignore
    }
    throw new Error('Downloaded friend image looks incomplete');
  }
  return dest;
}

