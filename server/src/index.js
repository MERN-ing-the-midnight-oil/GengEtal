import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { config } from './config.js';
import jobsRouter from './routes/jobs.js';
import setupRouter from './routes/setup.js';
import {
  getDriveAuthStatus,
  isAuthenticated,
  isDriveConfigured,
  ensureDriveLayout,
} from './services/drive.js';
import { getNotebookSettings } from './services/settings.js';
import { startSyncLoop, refreshColabStatus } from './services/sync.js';

fs.mkdirSync(config.imageCacheDir, { recursive: true });

const app = express();
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  const notebook = getNotebookSettings();
  res.json({
    ok: true,
    drive: getDriveAuthStatus(),
    notebookUrl: notebook.url || config.colabNotebookUrl || config.templateNotebookUrl,
    templateNotebookUrl: config.templateNotebookUrl,
  });
});

app.use('/api/setup', setupRouter);
app.use('/api/jobs', jobsRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function boot() {
  console.log('Visual Anagrams batch server starting...');

  if (isDriveConfigured() && isAuthenticated()) {
    try {
      await ensureDriveLayout();
      await refreshColabStatus();
      startSyncLoop();
      console.log('Google Drive ready. Sync loop started.');
    } catch (err) {
      console.error('Drive init failed (server will still run locally):', err.message);
    }
  } else if (!isDriveConfigured()) {
    console.warn(
      'Google OAuth client not configured. Add credentials.json or GOOGLE_CLIENT_ID/SECRET.'
    );
  } else {
    console.warn('Not signed in yet. Open the app and use Login with Google.');
  }

  app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
    console.log(`Frontend expected at ${config.clientOrigin}`);
  });
}

boot();