/*
 * Create / verify chain/keys/firebase-service-account.json for queue processors.
 * Uses your existing Firebase CLI login (npx firebase from repo root).
 *
 * Usage: npm run firebase:setup
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { KEYS_DIR } from './common.js';
import { PROJECT_ID, SERVICE_ACCOUNT_PATH } from './firebase.js';

const STORE_PATH = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
const FIREBASE_CLIENT_ID =
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLIENT_SECRET = 'j9iVZgKtrWEnBbq-uo45pIr1';

async function getAccessToken() {
  if (!fs.existsSync(STORE_PATH)) {
    throw new Error(
      'Firebase CLI not logged in. From repo root run: npx firebase login'
    );
  }
  const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  const tokens = store.tokens || {};
  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 60_000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) {
    throw new Error('Firebase CLI login expired. Run: npx firebase login');
  }
  const body = new URLSearchParams({
    client_id: FIREBASE_CLIENT_ID,
    client_secret: FIREBASE_CLIENT_SECRET,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error('Token refresh failed: ' + JSON.stringify(json));
  return json.access_token;
}

async function api(accessToken, url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${opts.method || 'GET'} ${url} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

async function ensureKey() {
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    const existing = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
    console.log('Key already present:', SERVICE_ACCOUNT_PATH);
    console.log('  client_email:', existing.client_email);
    console.log('  project_id:', existing.project_id);
    return existing;
  }

  console.log('Creating service account key for', PROJECT_ID, '…');
  const accessToken = await getAccessToken();
  const listed = await api(
    accessToken,
    `https://iam.googleapis.com/v1/projects/${PROJECT_ID}/serviceAccounts`
  );
  const accounts = listed.accounts || [];
  const target =
    accounts.find((a) => a.email.includes('firebase-adminsdk')) ||
    accounts.find((a) => a.email === `${PROJECT_ID}@appspot.gserviceaccount.com`);
  if (!target) {
    throw new Error('No firebase-adminsdk service account found in project ' + PROJECT_ID);
  }

  const keyResp = await api(accessToken, `https://iam.googleapis.com/v1/${target.name}/keys`, {
    method: 'POST',
    body: JSON.stringify({
      privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE',
      keyAlgorithm: 'KEY_ALG_RSA_2048',
    }),
  });
  const parsed = JSON.parse(Buffer.from(keyResp.privateKeyData, 'base64').toString('utf8'));
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(SERVICE_ACCOUNT_PATH, JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(SERVICE_ACCOUNT_PATH, 0o600);
  console.log('Wrote', SERVICE_ACCOUNT_PATH);
  console.log('  client_email:', parsed.client_email);
  return parsed;
}

async function verify() {
  // Dynamic import so missing key still allows create path first.
  const { initFirestore } = await import('./firebase.js');
  const db = initFirestore();
  const snap = await db.collection('seedMints').limit(1).get();
  console.log('Firestore OK — seedMints reachable (', snap.size, 'sample docs)');
}

await ensureKey();
await verify();
console.log('\nFirebase service wired. Next:');
console.log('  npm run mint:queue:watch');
console.log('  npm run grow:queue:watch');
console.log('  npm run market:queue:watch');
