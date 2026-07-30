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

export function createJob({ prompt_1, prompt_2 }) {
  return request('/api/jobs', {
    method: 'POST',
    body: JSON.stringify({ prompt_1, prompt_2 }),
  });
}

export function deleteJob(id) {
  return request(`/api/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}