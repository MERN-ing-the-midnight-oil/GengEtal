import express from 'express';
import { config } from '../config.js';
import {
  ensureUserNotebook,
  ensureDriveLayout,
  exchangeCode,
  getAuthUrl,
  getDriveAuthStatus,
  isAuthenticated,
  isDriveConfigured,
  resetDriveClient,
  syncSecretsToDrive,
} from '../services/drive.js';
import {
  getSecretsPublicStatus,
  saveDeveloperOAuthClient,
  saveUserSecrets,
} from '../services/secrets.js';
import { getNotebookSettings, saveNotebookSettings } from '../services/settings.js';
import { startSyncLoop } from '../services/sync.js';

const router = express.Router();

router.get('/status', (_req, res) => {
  const auth = getDriveAuthStatus();
  const notebook = getNotebookSettings();
  const secrets = getSecretsPublicStatus();
  res.json({
    driveConfigured: isDriveConfigured(),
    authenticated: isAuthenticated(),
    credentialsPresent: auth.credentialsPresent,
    tokenPresent: auth.tokenPresent,
    secrets,
    oauthClient: secrets.oauthClient,
    templateNotebookUrl: config.templateNotebookUrl,
    templateNotebookId: config.templateNotebookId,
    oauthRedirectUri: config.oauthRedirectUri,
    notebook,
    setupComplete: Boolean(
      secrets.ready && auth.tokenPresent && notebook.ready
    ),
  });
});

router.post('/credentials', async (req, res) => {
  try {
    const secrets = saveUserSecrets({
      huggingface_token: req.body?.huggingface_token,
      remember_me: req.body?.remember_me,
    });

    if (isAuthenticated()) {
      try {
        await syncSecretsToDrive();
      } catch (err) {
        console.warn('Could not sync secrets to Drive yet:', err.message);
      }
    }

    res.json({ ok: true, secrets });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** One-time app-developer OAuth client (not per end-user Google login). */
router.post('/oauth-client', (req, res) => {
  try {
    const oauthClient = saveDeveloperOAuthClient({
      client_id: req.body?.client_id,
      client_secret: req.body?.client_secret,
    });
    resetDriveClient();
    res.json({
      ok: true,
      oauthClient,
      driveConfigured: true,
      secrets: getSecretsPublicStatus(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/auth/google', (_req, res) => {
  try {
    if (!isDriveConfigured()) {
      return res.redirect(
        `${config.clientOrigin}/?auth=error&message=${encodeURIComponent(
          'App Google OAuth client is not configured. The app developer must set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or credentials/credentials.json).'
        )}`
      );
    }
    const url = getAuthUrl();
    res.redirect(url);
  } catch (err) {
    res.redirect(
      `${config.clientOrigin}/?auth=error&message=${encodeURIComponent(err.message)}`
    );
  }
});

router.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) {
      return res.redirect(
        `${config.clientOrigin}/?auth=error&message=${encodeURIComponent(String(error))}`
      );
    }
    if (!code) {
      return res.redirect(
        `${config.clientOrigin}/?auth=error&message=${encodeURIComponent('Missing OAuth code')}`
      );
    }

    await exchangeCode(String(code));
    resetDriveClient();

    try {
      await ensureDriveLayout();
      const secrets = getSecretsPublicStatus();
      if (secrets.ready) {
        await syncSecretsToDrive();
      }
      startSyncLoop();
    } catch (err) {
      console.error('Post-auth Drive setup warning:', err.message);
    }

    const existing = getNotebookSettings();
    if (!existing.ready) {
      try {
        const notebook = await ensureUserNotebook();
        saveNotebookSettings(notebook);
        const flag = notebook.isOwner ? 'owner' : 'copied';
        return res.redirect(`${config.clientOrigin}/?auth=ok&notebook=${flag}`);
      } catch (err) {
        console.error('Notebook setup failed:', err.message);
        return res.redirect(
          `${config.clientOrigin}/?auth=ok&notebook=error&message=${encodeURIComponent(err.message)}`
        );
      }
    }

    res.redirect(`${config.clientOrigin}/?auth=ok&notebook=ready`);
  } catch (err) {
    console.error('OAuth callback failed:', err);
    res.redirect(
      `${config.clientOrigin}/?auth=error&message=${encodeURIComponent(err.message)}`
    );
  }
});

router.post('/ensure-notebook', async (req, res) => {
  try {
    if (!isAuthenticated()) {
      return res.status(401).json({ error: 'Login with Google first' });
    }

    const force = Boolean(req.body?.force);
    const existing = getNotebookSettings();
    if (existing.ready && !force) {
      return res.json({ notebook: existing, reused: true });
    }

    await syncSecretsToDrive();
    const resolved = await ensureUserNotebook();
    const notebook = saveNotebookSettings(resolved);
    res.json({ notebook, reused: false });
  } catch (err) {
    console.error('ensure-notebook failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;