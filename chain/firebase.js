/*
 * Shared Firebase Admin bootstrap for the queue processors.
 * Needs chain/keys/firebase-service-account.json (gitignored).
 * Create via: npm run firebase:setup
 */
import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { KEYS_DIR } from './common.js';

const SERVICE_ACCOUNT_PATH = path.join(KEYS_DIR, 'firebase-service-account.json');
const PROJECT_ID = 'balpha-9dab9';

export { SERVICE_ACCOUNT_PATH, PROJECT_ID };

export function initFirestore() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(
      'Missing Firebase service account key.\n' +
        'Run: npm run firebase:setup\n' +
        'Or download from Firebase Console → Project settings → Service accounts\n' +
        '→ "Generate new private key" and save it as:\n  ' +
        SERVICE_ACCOUNT_PATH
    );
    process.exit(1);
  }
  if (!getApps().length) {
    const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
    initializeApp({
      credential: cert(sa),
      projectId: sa.project_id || PROJECT_ID,
    });
  }
  return getFirestore();
}
