import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const ACCOUNTS_FILENAME = 'google-accounts.json';

function accountsDir() {
  return path.resolve(path.dirname(config.tokenPath), 'accounts');
}

function registryPath() {
  return path.resolve(path.dirname(config.tokenPath), ACCOUNTS_FILENAME);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function emptyRegistry() {
  return { activeAccountId: null, accounts: [] };
}

function readRegistry() {
  const raw = readJsonSafe(registryPath());
  if (!raw || !Array.isArray(raw.accounts)) return emptyRegistry();
  return {
    activeAccountId: raw.activeAccountId || null,
    accounts: raw.accounts.filter((a) => a && a.id),
  };
}

function writeRegistry(registry) {
  writeJson(registryPath(), {
    activeAccountId: registry.activeAccountId || null,
    accounts: registry.accounts || [],
  });
}

export function accountTokenPath(accountId) {
  return path.join(accountsDir(), String(accountId), 'token.json');
}

/** Active Google token path (per-account file, or legacy token.json). */
export function getActiveTokenPath() {
  const registry = readRegistry();
  if (registry.activeAccountId) {
    const p = accountTokenPath(registry.activeAccountId);
    if (fs.existsSync(p)) return p;
  }
  if (fs.existsSync(config.tokenPath)) return config.tokenPath;
  return accountTokenPath(registry.activeAccountId || 'pending');
}

export function getActiveAccountId() {
  return readRegistry().activeAccountId || null;
}

export function listAccounts() {
  const registry = readRegistry();
  return {
    activeAccountId: registry.activeAccountId,
    accounts: registry.accounts.map((a) => ({
      id: a.id,
      email: a.email || null,
      displayName: a.displayName || null,
      addedAt: a.addedAt || null,
      lastUsedAt: a.lastUsedAt || null,
      active: a.id === registry.activeAccountId,
      hasToken: fs.existsSync(accountTokenPath(a.id)),
    })),
  };
}

export function getActiveAccount() {
  const { activeAccountId, accounts } = listAccounts();
  if (!activeAccountId) return null;
  return accounts.find((a) => a.id === activeAccountId) || null;
}

function syncLegacyTokenCopy(accountId) {
  const src = accountTokenPath(accountId);
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(config.tokenPath));
  fs.copyFileSync(src, config.tokenPath);
}

/**
 * Persist OAuth tokens for an account and mark it active.
 * @returns {{ account: object, isNew: boolean }}
 */
export function upsertAccountTokens({ id, email, displayName, tokens }) {
  if (!id) throw new Error('Google account id is required');
  if (!tokens) throw new Error('OAuth tokens are required');

  const tokenFile = accountTokenPath(id);
  writeJson(tokenFile, tokens);

  const registry = readRegistry();
  const now = new Date().toISOString();
  const existingIdx = registry.accounts.findIndex((a) => a.id === id);
  const isNew = existingIdx < 0;
  const next = {
    id,
    email: email || registry.accounts[existingIdx]?.email || null,
    displayName:
      displayName || registry.accounts[existingIdx]?.displayName || null,
    addedAt: isNew ? now : registry.accounts[existingIdx]?.addedAt || now,
    lastUsedAt: now,
  };

  if (isNew) {
    registry.accounts.push(next);
  } else {
    registry.accounts[existingIdx] = {
      ...registry.accounts[existingIdx],
      ...next,
    };
  }

  registry.activeAccountId = id;
  writeRegistry(registry);
  syncLegacyTokenCopy(id);

  return { account: next, isNew };
}

export function setActiveAccount(accountId) {
  const registry = readRegistry();
  const account = registry.accounts.find((a) => a.id === accountId);
  if (!account) {
    throw new Error('Google account not found');
  }
  if (!fs.existsSync(accountTokenPath(accountId))) {
    throw new Error('No saved token for that Google account — sign in again');
  }

  registry.activeAccountId = accountId;
  account.lastUsedAt = new Date().toISOString();
  writeRegistry(registry);
  syncLegacyTokenCopy(accountId);
  return listAccounts();
}

export function removeAccount(accountId) {
  const registry = readRegistry();
  const idx = registry.accounts.findIndex((a) => a.id === accountId);
  if (idx < 0) {
    throw new Error('Google account not found');
  }

  registry.accounts.splice(idx, 1);
  const tokenFile = accountTokenPath(accountId);
  try {
    if (fs.existsSync(tokenFile)) fs.unlinkSync(tokenFile);
    const dir = path.dirname(tokenFile);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch {
    /* ignore cleanup errors */
  }

  if (registry.activeAccountId === accountId) {
    registry.activeAccountId = registry.accounts[0]?.id || null;
    if (registry.activeAccountId) {
      syncLegacyTokenCopy(registry.activeAccountId);
    } else if (fs.existsSync(config.tokenPath)) {
      fs.unlinkSync(config.tokenPath);
    }
  }

  writeRegistry(registry);
  return listAccounts();
}

/**
 * If a legacy token.json exists but no account registry yet, create a placeholder
 * account so the app keeps working until the next Drive call fills email.
 */
export function migrateLegacyTokenIfNeeded() {
  const registry = readRegistry();
  if (registry.accounts.length > 0) return listAccounts();
  if (!fs.existsSync(config.tokenPath)) return listAccounts();

  const legacyId = 'legacy';
  ensureDir(path.dirname(accountTokenPath(legacyId)));
  fs.copyFileSync(config.tokenPath, accountTokenPath(legacyId));
  const now = new Date().toISOString();
  writeRegistry({
    activeAccountId: legacyId,
    accounts: [
      {
        id: legacyId,
        email: null,
        displayName: 'Google account',
        addedAt: now,
        lastUsedAt: now,
      },
    ],
  });
  return listAccounts();
}

/** Replace a temporary/legacy account id after we learn the real Google identity. */
export function renameAccountId(fromId, toId, { email, displayName } = {}) {
  if (!fromId || !toId || fromId === toId) return listAccounts();

  const registry = readRegistry();
  const idx = registry.accounts.findIndex((a) => a.id === fromId);
  if (idx < 0) return listAccounts();

  const existingTarget = registry.accounts.find((a) => a.id === toId);
  const fromToken = accountTokenPath(fromId);
  const toToken = accountTokenPath(toId);

  if (fs.existsSync(fromToken)) {
    ensureDir(path.dirname(toToken));
    fs.copyFileSync(fromToken, toToken);
    try {
      fs.unlinkSync(fromToken);
      fs.rmdirSync(path.dirname(fromToken));
    } catch {
      /* ignore */
    }
  }

  if (existingTarget) {
    registry.accounts.splice(idx, 1);
    existingTarget.email = email || existingTarget.email;
    existingTarget.displayName = displayName || existingTarget.displayName;
    existingTarget.lastUsedAt = new Date().toISOString();
  } else {
    registry.accounts[idx] = {
      ...registry.accounts[idx],
      id: toId,
      email: email || registry.accounts[idx].email,
      displayName: displayName || registry.accounts[idx].displayName,
      lastUsedAt: new Date().toISOString(),
    };
  }

  if (registry.activeAccountId === fromId) {
    registry.activeAccountId = toId;
    syncLegacyTokenCopy(toId);
  }

  writeRegistry(registry);
  return listAccounts();
}

export function updateAccountProfile(accountId, { email, displayName } = {}) {
  const registry = readRegistry();
  const account = registry.accounts.find((a) => a.id === accountId);
  if (!account) return null;
  if (email) account.email = email;
  if (displayName) account.displayName = displayName;
  writeRegistry(registry);
  return account;
}

// Bootstrap legacy token → account registry on import.
migrateLegacyTokenIfNeeded();
