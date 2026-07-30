/**
 * Standalone OAuth helper: npm run auth
 * Opens the Google consent flow and saves credentials/token.json
 */
import { ensureDriveLayout, getAuthorizedClient } from './services/drive.js';

async function main() {
  console.log('Starting Google Drive OAuth…');
  await getAuthorizedClient({ allowInteractive: true });
  const folders = await ensureDriveLayout();
  console.log('Drive folders ready:', folders);
  console.log('Auth complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});