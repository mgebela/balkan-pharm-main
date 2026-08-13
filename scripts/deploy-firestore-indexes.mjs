#!/usr/bin/env node
/**
 * Deploy firestore.indexes.json via the Firestore Admin API.
 * Avoids `firebase deploy`'s Service Usage API check (which our CI SA cannot
 * call) — same reason scripts/deploy-firestore-rules.mjs talks to the REST API
 * directly.
 *
 * This exists because firestore.indexes.json sat in the repo for months with no
 * deploy path at all. The composite indexes were never created, so the public
 * journal query failed with FAILED_PRECONDITION on every page load and fell
 * back to an unordered limit(80) scan — silently, behind a console.warn.
 *
 * Creates are idempotent: an index that already exists returns 409
 * ALREADY_EXISTS and is reported as `exists`, not an error.
 *
 * Auth: GOOGLE_APPLICATION_CREDENTIALS → service account JSON
 *   or FIREBASE_SERVICE_ACCOUNT_JSON env (raw JSON string)
 *
 * Usage:
 *   node scripts/deploy-firestore-indexes.mjs             # create, report state
 *   node scripts/deploy-firestore-indexes.mjs --wait      # also wait for READY
 *   node scripts/deploy-firestore-indexes.mjs --dry-run   # report the plan only
 *
 * --dry-run needs only list permission, so it works with a read-only SA and is
 * the safe thing to run on a pull request.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PROJECT = process.env.FIREBASE_PROJECT || 'balpha-9dab9';
const DATABASE = process.env.FIRESTORE_DATABASE || '(default)';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEXES_PATH = path.join(ROOT, 'firestore.indexes.json');
const API = 'https://firestore.googleapis.com/v1';

const WAIT = process.argv.includes('--wait');
const DRY_RUN = process.argv.includes('--dry-run');
const WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const WAIT_POLL_MS = 10 * 1000;

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
        'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
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
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + makeJwt(sa),
  });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error('Token exchange failed: ' + JSON.stringify(json));
  }
  return json.access_token;
}

function indexesUrl(collectionGroup) {
  return (
    `${API}/projects/${PROJECT}/databases/${DATABASE}` +
    `/collectionGroups/${encodeURIComponent(collectionGroup)}/indexes`
  );
}

/** Stable signature for comparing a local index spec to a deployed one. */
function signature(collectionGroup, queryScope, fields) {
  const parts = fields.map((f) =>
    [f.fieldPath, f.order || '', f.arrayConfig || ''].join(':'),
  );
  return `${collectionGroup}|${queryScope}|${parts.join(',')}`;
}

/**
 * Fields as the API wants them. `__name__` is implicit on create — Firestore
 * appends it — so a trailing __name__ in the local file is dropped rather than
 * sent, which would otherwise be rejected.
 */
function apiFields(fields) {
  return fields
    .filter((f) => f.fieldPath !== '__name__')
    .map((f) => {
      const out = { fieldPath: f.fieldPath };
      if (f.arrayConfig) out.arrayConfig = f.arrayConfig;
      else out.order = f.order || 'ASCENDING';
      return out;
    });
}

/** `projects/P/databases/(default)/collectionGroups/GROUP/indexes/ID` → GROUP. */
function collectionGroupOf(name) {
  const m = /\/collectionGroups\/([^/]+)\/indexes\//.exec(String(name || ''));
  return m ? decodeURIComponent(m[1]) : '';
}

/**
 * List every composite index in the database.
 *
 * The collectionGroup segment in the LIST url is *ignored* by the API — asking
 * for one group returns indexes for all of them — so the group is read back
 * off each index's own resource name instead of being inferred from the
 * request. Verified against balpha-9dab9: listing `publicJournalPosts` and
 * `marketListings` both return the `growthMints` index.
 */
async function listAllIndexes(auth) {
  const byName = new Map();
  let pageToken = '';
  do {
    // Any group works; the API returns the whole database either way.
    const url =
      indexesUrl('publicJournalPosts') + (pageToken ? `?pageToken=${pageToken}` : '');
    const res = await fetch(url, { headers: auth });
    const json = await res.json();
    if (!res.ok) {
      throw new Error('List indexes failed: ' + JSON.stringify(json));
    }
    for (const idx of json.indexes || []) byName.set(idx.name, idx);
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return [...byName.values()];
}

async function createIndex(auth, collectionGroup, queryScope, fields) {
  const res = await fetch(indexesUrl(collectionGroup), {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ queryScope, fields: apiFields(fields) }),
  });
  const json = await res.json();
  if (res.status === 409) return { status: 'exists' };
  if (!res.ok) {
    throw new Error(
      `Create index failed for ${collectionGroup}: ` + JSON.stringify(json),
    );
  }
  return { status: 'creating', operation: json.name || null };
}

/** Reported state of every index belonging to the groups we manage. */
async function statesFor(auth, groups) {
  const want = new Set(groups);
  return (await listAllIndexes(auth))
    .filter((idx) => want.has(collectionGroupOf(idx.name)))
    .map((idx) => ({
      collectionGroup: collectionGroupOf(idx.name),
      state: idx.state || 'UNKNOWN',
      fields: (idx.fields || [])
        .filter((f) => f.fieldPath !== '__name__')
        .map((f) => `${f.fieldPath}:${f.order || f.arrayConfig}`)
        .join(', '),
    }));
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(INDEXES_PATH, 'utf8'));
  const wanted = spec.indexes || [];
  if (!wanted.length) {
    throw new Error('firestore.indexes.json declares no indexes — refusing to deploy');
  }

  // The public journal feed is the query that regressed. If its index ever
  // disappears from the file, fail loudly here rather than shipping a config
  // that quietly drops the site back onto the limit(80) fallback.
  const hasJournalFeed = wanted.some(
    (i) =>
      i.collectionGroup === 'publicJournalPosts' &&
      i.fields.some((f) => f.fieldPath === 'hiddenByAdmin') &&
      i.fields.some((f) => f.fieldPath === 'publishedAt'),
  );
  if (!hasJournalFeed) {
    throw new Error(
      'firestore.indexes.json is missing the publicJournalPosts ' +
        'hiddenByAdmin + publishedAt index — refusing to deploy',
    );
  }

  // fieldOverrides need a different endpoint (patching field configs). Nothing
  // uses them yet; fail loudly rather than skipping them in silence.
  if ((spec.fieldOverrides || []).length) {
    throw new Error(
      'firestore.indexes.json declares fieldOverrides, which this script does ' +
        'not deploy. Add support before relying on them.',
    );
  }

  const sa = loadServiceAccount();
  const token = await accessToken(sa);
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const groups = [...new Set(wanted.map((i) => i.collectionGroup))];
  const existing = new Set(
    (await listAllIndexes(auth)).map((idx) =>
      signature(
        collectionGroupOf(idx.name),
        idx.queryScope || 'COLLECTION',
        apiFields(idx.fields || []),
      ),
    ),
  );

  const results = [];
  for (const idx of wanted) {
    const queryScope = idx.queryScope || 'COLLECTION';
    const sig = signature(idx.collectionGroup, queryScope, apiFields(idx.fields));
    if (existing.has(sig)) {
      results.push({ collectionGroup: idx.collectionGroup, status: 'exists' });
      continue;
    }
    if (DRY_RUN) {
      results.push({
        collectionGroup: idx.collectionGroup,
        status: 'would-create',
        fields: apiFields(idx.fields)
          .map((f) => `${f.fieldPath}:${f.order || f.arrayConfig}`)
          .join(', '),
      });
      continue;
    }
    const res = await createIndex(auth, idx.collectionGroup, queryScope, idx.fields);
    results.push({ collectionGroup: idx.collectionGroup, ...res });
  }

  if (DRY_RUN) {
    const missing = results.filter((r) => r.status === 'would-create');
    console.log(
      JSON.stringify(
        { ok: true, dryRun: true, project: PROJECT, missing: missing.length, results },
        null,
        2,
      ),
    );
    return;
  }

  let states = await statesFor(auth, groups);

  if (WAIT) {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (states.some((s) => s.state === 'CREATING') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
      states = await statesFor(auth, groups);
    }
    const stuck = states.filter((s) => s.state === 'CREATING');
    if (stuck.length) {
      console.error(JSON.stringify({ ok: false, stillBuilding: stuck }, null, 2));
      throw new Error('Timed out waiting for indexes to reach READY');
    }
  }

  const needsRepair = states.filter((s) => s.state === 'NEEDS_REPAIR');
  if (needsRepair.length) {
    console.error(JSON.stringify({ ok: false, needsRepair }, null, 2));
    throw new Error('Some indexes are in NEEDS_REPAIR');
  }

  console.log(
    JSON.stringify({ ok: true, project: PROJECT, results, states }, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
