#!/usr/bin/env node
/**
 * Deploy firestore.rules via the Firebase Rules API.
 * Avoids `firebase deploy`'s Service Usage API check (which our CI SA cannot call).
 *
 * Auth: GOOGLE_APPLICATION_CREDENTIALS → service account JSON
 *   or FIREBASE_SERVICE_ACCOUNT_JSON env (raw JSON string)
 *
 * Usage: node scripts/deploy-firestore-rules.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PROJECT = process.env.FIREBASE_PROJECT || 'balpha-9dab9';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RULES_PATH = path.join(ROOT, 'firestore.rules');

function loadServiceAccount() {
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

function makeJwt(sa) {
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
      scope:
        'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform',
    }),
  ).toString('base64url');
  const data = `${header}.${claim}`;
  const sign = createSign('RSA-SHA256');
  sign.update(data);
  return `${data}.${sign.sign(sa.private_key, 'base64url')}`;
}

async function accessToken(sa) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
      makeJwt(sa),
  });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error('Token exchange failed: ' + JSON.stringify(json));
  }
  return json.access_token;
}

async function main() {
  const content = fs.readFileSync(RULES_PATH, 'utf8');
  if (!content.includes('match /marketListings')) {
    throw new Error('firestore.rules looks invalid (no marketListings match)');
  }
  if (content.includes('walletLinkPatchAllowed')) {
    throw new Error(
      'firestore.rules still contains walletLinkPatchAllowed — refuse to deploy',
    );
  }
  // Guard: marketListings must not be publicly readable
  const marketBlock = content.slice(
    content.indexOf('match /marketListings'),
    content.indexOf('match /marketListings') + 500,
  );
  if (/allow read:\s*if true/.test(marketBlock)) {
    throw new Error('Refusing to deploy: marketListings allow read: if true');
  }

  const sa = loadServiceAccount();
  const token = await accessToken(sa);
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const createRes = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets`,
    {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        source: { files: [{ name: 'firestore.rules', content }] },
      }),
    },
  );
  const created = await createRes.json();
  if (!createRes.ok || !created.name) {
    throw new Error('Create ruleset failed: ' + JSON.stringify(created));
  }

  const releaseRes = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`,
    {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({
        release: {
          name: `projects/${PROJECT}/releases/cloud.firestore`,
          rulesetName: created.name,
        },
        updateMask: 'rulesetName',
      }),
    },
  );
  const released = await releaseRes.json();
  if (!releaseRes.ok) {
    throw new Error('Release failed: ' + JSON.stringify(released));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: PROJECT,
        rulesetName: created.name,
        updateTime: released.updateTime,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
