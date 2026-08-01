async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export function fetchJobs({ status, q } = {}) {
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (q) params.set('q', q);
  const qs = params.toString();
  return request(`/api/jobs${qs ? `?${qs}` : ''}`);
}

export function fetchStatus() {
  return request('/api/jobs/status');
}

export function fetchSetupStatus() {
  return request('/api/setup/status');
}

export function ensureNotebook(force = false) {
  return request('/api/setup/ensure-notebook', {
    method: 'POST',
    body: JSON.stringify({ force }),
  });
}

export function saveCredentials(payload) {
  return request('/api/setup/credentials', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function saveOAuthClient({ client_id, client_secret }) {
  return request('/api/setup/oauth-client', {
    method: 'POST',
    body: JSON.stringify({ client_id, client_secret }),
  });
}

export function switchGoogleAccount(accountId) {
  return request('/api/setup/accounts/switch', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });
}

export function removeGoogleAccount(accountId) {
  return request(`/api/setup/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  });
}

export function createJob({ prompt_1, prompt_2 }) {
  return request('/api/jobs', {
    method: 'POST',
    body: JSON.stringify({ prompt_1, prompt_2 }),
  });
}

export function setWorkerTier(tier) {
  return request('/api/setup/worker-tier', {
    method: 'POST',
    body: JSON.stringify({ tier }),
  });
}

export function saveNotebookUrl({ url, tier, name }) {
  return request('/api/setup/notebook-url', {
    method: 'POST',
    body: JSON.stringify({ url, tier, name }),
  });
}

export function saveGenerationSettings({ resolution, num_inference_steps }) {
  return request('/api/setup/generation-settings', {
    method: 'POST',
    body: JSON.stringify({ resolution, num_inference_steps }),
  });
}

export function saveBurnCalibration(payload) {
  return request('/api/setup/burn-calibration', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteJob(id) {
  return request(`/api/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function publishJob(id) {
  return request(`/api/jobs/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
  });
}

export function unpublishJob(id) {
  return request(`/api/jobs/${encodeURIComponent(id)}/publish`, {
    method: 'DELETE',
  });
}

export function fetchMyGalleryShare() {
  return request('/api/friends/me');
}

export function fetchFriends() {
  return request('/api/friends');
}

export function addFriend(galleryLink) {
  return request('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ galleryLink }),
  });
}

export function removeFriend(friendId) {
  return request(`/api/friends/${encodeURIComponent(friendId)}`, {
    method: 'DELETE',
  });
}

export function fetchFriendsGallery() {
  return request('/api/friends/gallery');
}