import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: path.join(serverRoot, '.env') });

function resolvePath(value, fallback) {
  const raw = value || fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(serverRoot, raw);
}

const DEFAULT_TEMPLATE_ID = '1fL4X4wJSHoFZBaWK77lb-EHW6Lb-c6Jd';

export const config = {
  port: Number(process.env.PORT || 3001),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:2222',
  credentialsPath: resolvePath(
    process.env.GOOGLE_CREDENTIALS_PATH,
    '../credentials/credentials.json'
  ),
  oauthClientPath: resolvePath(
    process.env.GOOGLE_OAUTH_CLIENT_PATH,
    '../credentials/oauth-client.json'
  ),
  userSecretsPath: resolvePath(
    process.env.USER_SECRETS_PATH,
    '../credentials/user-secrets.json'
  ),
  driveSecretsFilename: process.env.DRIVE_SECRETS_FILENAME || 'secrets.json',
  tokenPath: resolvePath(process.env.GOOGLE_TOKEN_PATH, '../credentials/token.json'),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  sqlitePath: resolvePath(process.env.SQLITE_PATH, '../data/jobs.db'),
  imageCacheDir: resolvePath(process.env.IMAGE_CACHE_DIR, '../cache/images'),
  driveQueueFolder: process.env.DRIVE_QUEUE_FOLDER || 'visual_anagrams',
  driveResultsFolder: process.env.DRIVE_RESULTS_FOLDER || 'visual_anagrams_results',
  jobQueueFilename: process.env.JOB_QUEUE_FILENAME || 'job_queue.json',
  heartbeatFilename: process.env.HEARTBEAT_FILENAME || 'colab_heartbeat.json',
  colabOnlineThresholdMs: Number(process.env.COLAB_ONLINE_THRESHOLD_MS || 120000),
  syncIntervalMs: Number(process.env.SYNC_INTERVAL_MS || 15000),
  colabNotebookUrl: process.env.COLAB_NOTEBOOK_URL || '',
  templateNotebookId: process.env.TEMPLATE_NOTEBOOK_ID || DEFAULT_TEMPLATE_ID,
  templateNotebookUrl:
    process.env.TEMPLATE_NOTEBOOK_URL ||
    `https://colab.research.google.com/drive/${process.env.TEMPLATE_NOTEBOOK_ID || DEFAULT_TEMPLATE_ID}?usp=sharing`,
  templateNotebookCopyName:
    process.env.TEMPLATE_NOTEBOOK_COPY_NAME || 'Visual Anagrams Batch Worker',
  oauthRedirectPort: Number(process.env.OAUTH_REDIRECT_PORT || 3456),
  // Prefer app URL (Vite proxies /api → Express) so the user stays on :2222
  oauthRedirectUri:
    process.env.OAUTH_REDIRECT_URI ||
    'http://localhost:2222/api/setup/auth/google/callback',
  repoRoot,
  serverRoot,
};