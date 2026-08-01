import express from 'express';
import { config } from '../config.js';
import { assignNullJobsToAccount } from '../db.js';
import {
  getActiveAccount,
  listAccounts,
  removeAccount,
  setActiveAccount,
} from '../services/accounts.js';
import {
  ensureUserNotebook,
  ensureDriveLayout,
  exchangeCode,
  getAuthUrl,
  getDriveAuthStatus,
  isAuthenticated,
  isDriveConfigured,
  refreshActiveAccountProfile,
  resetDriveClient,
  syncSecretsToDrive,
} from '../services/drive.js';
import {
  getSecretsPublicStatus,
  saveDeveloperOAuthClient,
  saveUserSecrets,
} from '../services/secrets.js';
import {
  getBurnStatus,
  setBurnCalibration,
} from '../services/burnEstimate.js';
import {
  getGenerationSettings,
  getNotebookSettings,
  getWorkerTier,
  getWorkerTierInfo,
  parseColabNotebookUrl,
  saveNotebookSettings,
  setGenerationSettings,
  setWorkerTier,
} from '../services/settings.js';
import { resetSyncState, startSyncLoop, syncOnce } from '../services/sync.js';

const router = express.Router();

function accountsPayload() {
  return listAccounts();
}

async function activateDriveForCurrentAccount() {
  resetDriveClient();
  resetSyncState();
  await ensureDriveLayout();
  const secrets = getSecretsPublicStatus();
  if (secrets.ready) {
    try {
      await syncSecretsToDrive();
    } catch (err) {
      console.warn('Could not sync secrets to Drive:', err.message);
    }
  }
  startSyncLoop();
  try {
    await syncOnce();
  } catch (err) {
    console.warn('Post-switch sync warning:', err.message);
  }
}

router.get('/status', async (_req, res) => {
  const auth = getDriveAuthStatus();
  const tier = getWorkerTier();
  const notebook = getNotebookSettings(tier);
  const proNotebook = getNotebookSettings('pro');
  const secrets = getSecretsPublicStatus();
  // Setup can complete with the Pro notebook (or free, once linked).
  const setupNotebookReady = Boolean(proNotebook.ready || notebook.ready);

  let googleAccounts = accountsPayload();
  if (auth.tokenPresent) {
    try {
      // Fill email for legacy migrations / first boot after upgrade.
      const active = getActiveAccount();
      if (active && !active.email) {
        await refreshActiveAccountProfile();
        googleAccounts = accountsPayload();
      }
      const activeId = googleAccounts.activeAccountId;
      if (activeId) assignNullJobsToAccount(activeId);
    } catch (err) {
      console.warn('Could not refresh Google account profile:', err.message);
    }
  }

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
    workerTier: getWorkerTierInfo(),
    generation: getGenerationSettings(),
    burn: getBurnStatus(),
    notebook,
    googleAccount: getActiveAccount(),
    googleAccounts,
    setupComplete: Boolean(
      secrets.ready && auth.tokenPresent && setupNotebookReady
    ),
  });
});

router.get('/accounts', (_req, res) => {
  res.json(accountsPayload());
});

router.post('/accounts/switch', async (req, res) => {
  try {
    const accountId = String(req.body?.accountId || '').trim();
    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }
    const googleAccounts = setActiveAccount(accountId);
    await activateDriveForCurrentAccount();
    const tier = getWorkerTier();
    res.json({
      ok: true,
      googleAccounts,
      googleAccount: getActiveAccount(),
      notebook: getNotebookSettings(tier),
      workerTier: getWorkerTierInfo(),
      message:
        'Switched Google Drive account. Open Colab with this same Google account and Run all.',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/accounts/:accountId', async (req, res) => {
  try {
    const accountId = String(req.params.accountId || '').trim();
    const wasActive = getActiveAccount()?.id === accountId;
    const googleAccounts = removeAccount(accountId);
    if (wasActive && googleAccounts.activeAccountId) {
      await activateDriveForCurrentAccount();
    } else if (wasActive) {
      resetDriveClient();
      resetSyncState();
    }
    res.json({
      ok: true,
      googleAccounts,
      googleAccount: getActiveAccount(),
      authenticated: isAuthenticated(),
      notebook: getNotebookSettings(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/worker-tier', (req, res) => {
  try {
    const tier = setWorkerTier(req.body?.tier);
    // Free worker always runs at 256 — keep saved prefs coherent.
    if (tier === 'free') {
      setGenerationSettings({ resolution: '256' });
    }
    res.json({
      workerTier: getWorkerTierInfo(),
      notebook: getNotebookSettings(tier),
      generation: getGenerationSettings(),
      burn: getBurnStatus(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/generation-settings', (req, res) => {
  try {
    const generation = setGenerationSettings({
      resolution: req.body?.resolution,
      num_inference_steps: req.body?.num_inference_steps,
    });
    res.json({
      generation,
      workerTier: getWorkerTierInfo(),
      burn: getBurnStatus(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/burn-calibration', (req, res) => {
  try {
    const calibration = setBurnCalibration({
      calibratedUnits: req.body?.calibratedUnits,
      calibratedJobs: req.body?.calibratedJobs,
      budgetUnits: req.body?.budgetUnits,
      deletedJobs: req.body?.deletedJobs,
    });
    res.json({
      calibration,
      burn: getBurnStatus(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Register a Colab notebook URL for the active (or specified) worker tier. */
router.post('/notebook-url', (req, res) => {
  try {
    const tier =
      String(req.body?.tier || getWorkerTier()).toLowerCase() === 'free'
        ? 'free'
        : 'pro';
    const parsed = parseColabNotebookUrl(req.body?.url);
    if (!parsed) {
      return res.status(400).json({
        error:
          'Paste a Colab URL like https://colab.research.google.com/drive/FILE_ID',
      });
    }
    const name =
      String(req.body?.name || '').trim() ||
      (tier === 'free'
        ? 'Visual Anagrams Batch Worker (Free)'
        : 'Visual Anagrams Batch Worker');
    const notebook = saveNotebookSettings({
      fileId: parsed.fileId,
      url: parsed.url,
      name,
      isOwner: true,
      copied: false,
      manualCopyHint: false,
      tier,
    });
    res.json({ notebook, workerTier: getWorkerTierInfo() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

router.get('/auth/google', (req, res) => {
  try {
    if (!isDriveConfigured()) {
      return res.redirect(
        `${config.clientOrigin}/?auth=error&message=${encodeURIComponent(
          'App Google OAuth client is not configured. The app developer must set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or credentials/credentials.json).'
        )}`
      );
    }
    const forceAccountPicker =
      req.query.select_account === '1' ||
      req.query.select_account === 'true' ||
      isAuthenticated();
    const url = getAuthUrl({ forceAccountPicker });
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

    const { account, isNew } = await exchangeCode(String(code));
    resetDriveClient();
    resetSyncState();
    if (account?.id) assignNullJobsToAccount(account.id);

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

    const existing = getNotebookSettings('pro');
    if (!existing.ready) {
      try {
        const notebook = await ensureUserNotebook();
        saveNotebookSettings({ ...notebook, tier: 'pro' });
        const flag = notebook.isOwner ? 'owner' : 'copied';
        return res.redirect(
          `${config.clientOrigin}/?auth=ok&notebook=${flag}&account=${encodeURIComponent(
            account?.email || account?.id || ''
          )}&new=${isNew ? '1' : '0'}`
        );
      } catch (err) {
        console.error('Notebook setup failed:', err.message);
        return res.redirect(
          `${config.clientOrigin}/?auth=ok&notebook=error&message=${encodeURIComponent(err.message)}`
        );
      }
    }

    res.redirect(
      `${config.clientOrigin}/?auth=ok&notebook=ready&account=${encodeURIComponent(
        account?.email || account?.id || ''
      )}&new=${isNew ? '1' : '0'}`
    );
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
    // Template copy is the Pro worker; free tier is uploaded from the repo notebook.
    const existing = getNotebookSettings('pro');
    if (existing.ready && !force) {
      return res.json({ notebook: existing, reused: true });
    }

    await syncSecretsToDrive();
    const resolved = await ensureUserNotebook();
    const notebook = saveNotebookSettings({ ...resolved, tier: 'pro' });
    res.json({ notebook, reused: false });
  } catch (err) {
    console.error('ensure-notebook failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
