/*
 * Shared Firebase Admin bootstrap for the queue processors.
 * Needs chain/keys/firebase-service-account.json (gitignored):
 * Firebase Console → Project settings → Service accounts → Generate new private key.
 */
import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';
import { KEYS_DIR } from './common.js';

const SERVICE_ACCOUNT_PATH = path.join(KEYS_DIR, 'firebase-service-account.json');

export { admin };

export function initFirestore() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(
      'Missing Firebase service account key.\n' +
        'Download it from Firebase Console → Project settings → Service accounts\n' +
        '→ "Generate new private key" and save it as:\n  ' +
        SERVICE_ACCOUNT_PATH
    );
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))),
    });
  }
  return admin.firestore();
}
