import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

/** In-memory HF token when the user opts out of "Remember me". */
let sessionHuggingFaceToken = null;

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function maskToken(token) {
  if (!token) return null;
  const t = String(token);
  if (t.length <= 8) return '••••';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function clearUserSecretsFile() {
  if (fs.existsSync(config.userSecretsPath)) {
    fs.unlinkSync(config.userSecretsPath);
  }
}

/** Per-user secrets from the UI (HF token only). Gitignored. */
export function readUserSecrets() {
  const raw = readJsonSafe(config.userSecretsPath) || {};
  return {
    huggingface_token: raw.huggingface_token || '',
    saved_at: raw.saved_at || null,
  };
}

/**
 * Save Hugging Face token.
 * remember_me=true → persist to user-secrets.json (survives restart)
 * remember_me=false → hold in process memory only; clear any saved file
 */
export function saveUserSecrets({ huggingface_token, remember_me = true } = {}) {
  const existing = getHuggingFaceToken();
  const nextToken =
    huggingface_token !== undefined && String(huggingface_token).trim() !== ''
      ? String(huggingface_token).trim()
      : existing;

  if (!nextToken) {
    throw new Error('Hugging Face token is required');
  }

  const remember = remember_me !== false && remember_me !== 'false';

  if (remember) {
    sessionHuggingFaceToken = null;
    ensureDir(config.userSecretsPath);
    fs.writeFileSync(
      config.userSecretsPath,
      JSON.stringify(
        {
          huggingface_token: nextToken,
          saved_at: new Date().toISOString(),
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  } else {
    sessionHuggingFaceToken = nextToken;
    clearUserSecretsFile();
  }

  return getSecretsPublicStatus();
}

/**
 * App OAuth client — configured once by the app developer
 * (UI bootstrap → oauth-client.json, or GOOGLE_CLIENT_ID/SECRET / credentials.json).
 * End users never create a Cloud project; they only complete Login with Google.
 */
export function readOAuthClient() {
  const oauthFile = readJsonSafe(config.oauthClientPath);
  if (oauthFile?.client_id && oauthFile?.client_secret) {
    return {
      client_id: String(oauthFile.client_id).trim(),
      client_secret: String(oauthFile.client_secret).trim(),
      source: 'file',
    };
  }

  if (config.googleClientId && config.googleClientSecret) {
    return {
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      source: 'env',
    };
  }

  const creds = readJsonSafe(config.credentialsPath);
  if (creds) {
    const installed = creds.installed || creds.web;
    if (installed?.client_id && installed?.client_secret) {
      return {
        client_id: installed.client_id,
        client_secret: installed.client_secret,
        source: 'credentials.json',
      };
    }
  }

  return null;
}

export function saveDeveloperOAuthClient({ client_id, client_secret }) {
  const id = String(client_id || '').trim();
  const secret = String(client_secret || '').trim();
  if (!id || !secret) {
    throw new Error('Both Client ID and Client Secret are required');
  }

  ensureDir(config.oauthClientPath);
  fs.writeFileSync(
    config.oauthClientPath,
    JSON.stringify(
      {
        client_id: id,
        client_secret: secret,
        saved_at: new Date().toISOString(),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );

  return getOAuthClientPublicStatus(readOAuthClient());
}

export function getOAuthClientPublicStatus(client = readOAuthClient()) {
  if (!client) {
    return { configured: false, clientIdPreview: null, source: null };
  }
  const id = client.client_id;
  const preview =
    id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : `${id.slice(0, 4)}…`;
  return {
    configured: true,
    clientIdPreview: preview,
    source: client.source,
  };
}

export function getSecretsPublicStatus() {
  const fileToken = readUserSecrets().huggingface_token || '';
  const sessionToken = sessionHuggingFaceToken || '';
  const hf = sessionToken || fileToken;
  const oauth = readOAuthClient();

  return {
    huggingface: {
      configured: Boolean(hf),
      preview: maskToken(hf),
      remembered: Boolean(fileToken) && !sessionToken,
    },
    oauthClient: getOAuthClientPublicStatus(oauth),
    // User form is ready when HF is saved; Drive OAuth client is separate (developer)
    ready: Boolean(hf),
  };
}

export function getHuggingFaceToken() {
  return sessionHuggingFaceToken || readUserSecrets().huggingface_token || '';
}
