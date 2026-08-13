/**
 * Service-account auth for the deploy scripts.
 *
 * These talk to the Google REST APIs directly rather than shelling out to
 * `firebase deploy`, because that command makes a Service Usage API call our
 * CI service account is not allowed to make.
 *
 * scripts/deploy-firestore-rules.mjs predates this module and still carries its
 * own copy of the same logic; it is deliberately left alone because it is a
 * working production deploy path. New scripts should import from here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/firebase',
  'https://www.googleapis.com/auth/cloud-platform',
];

export function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) return JSON.parse(raw);
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && fs.existsSync(credPath)) {
    return JSON.parse(fs.readFileSync(credPath, 'utf8'));
  }
  const local = path.join(ROOT, 'chain/keys/firebase-service-account.json');
  if (fs.existsSync(local)) {
    return JSON.parse(fs.readFileSync(local, 'utf8'));
  }
  throw new Error(
    'No credentials: set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS',
  );
}

function makeJwt(sa, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString(
    'base64url',
  );
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: (scopes && scopes.length ? scopes : DEFAULT_SCOPES).join(' '),
    }),
  ).toString('base64url');
  const data = `${header}.${claim}`;
  const sign = createSign('RSA-SHA256');
  sign.update(data);
  return `${data}.${sign.sign(sa.private_key, 'base64url')}`;
}

export async function accessToken(sa, scopes) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
      makeJwt(sa, scopes),
  });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error('Token exchange failed: ' + JSON.stringify(json));
  }
  return json.access_token;
}

/** Ready-to-use JSON auth headers for the Google REST APIs. */
export async function authHeaders(scopes) {
  const token = await accessToken(loadServiceAccount(), scopes);
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
}

export { ROOT };
