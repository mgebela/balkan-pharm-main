#!/usr/bin/env node
/**
 * Deploy storage.rules via the Firebase Rules API.
 *
 * Same approach as scripts/deploy-firestore-rules.mjs — the REST API rather
 * than `firebase deploy`, whose Service Usage API check our CI SA cannot make.
 *
 * A Storage ruleset is released under `firebase.storage/{bucket}`, not the
 * `cloud.firestore` release the Firestore script patches.
 *
 * Auth: GOOGLE_APPLICATION_CREDENTIALS → service account JSON
 *   or FIREBASE_SERVICE_ACCOUNT_JSON env (raw JSON string)
 *
 * Usage:
 *   node scripts/deploy-storage-rules.mjs
 *   node scripts/deploy-storage-rules.mjs --dry-run   # validate + show target
 */
import fs from 'node:fs';
import path from 'node:path';
import { authHeaders, ROOT } from './lib/google-auth.mjs';

const PROJECT = process.env.FIREBASE_PROJECT || 'balpha-9dab9';
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'balpha-9dab9.firebasestorage.app';
const RULES_PATH = path.join(ROOT, 'storage.rules');
const DRY_RUN = process.argv.includes('--dry-run');

function assertRulesSane(content) {
  if (!content.includes('service firebase.storage')) {
    throw new Error('storage.rules is not a Storage ruleset');
  }
  if (!/match \/users\/\{uid\}\/journal/.test(content)) {
    throw new Error('storage.rules is missing the users/{uid}/journal match');
  }
  // Journal photos are private. A rule that lets anyone read them would expose
  // every grower's plants, so refuse to ship one.
  if (/allow read:\s*if true/.test(content)) {
    throw new Error('Refusing to deploy: storage.rules has `allow read: if true`');
  }
  if (/allow (read, )?write:\s*if true/.test(content)) {
    throw new Error('Refusing to deploy: storage.rules has an unconditional write');
  }
  if (!/request\.auth\.uid == uid/.test(content)) {
    throw new Error('Refusing to deploy: storage.rules does not scope access by uid');
  }
}

async function main() {
  const content = fs.readFileSync(RULES_PATH, 'utf8');
  assertRulesSane(content);

  const releaseId = `firebase.storage/${BUCKET}`;

  if (DRY_RUN) {
    console.log(
      JSON.stringify(
        { ok: true, dryRun: true, project: PROJECT, release: releaseId, bytes: content.length },
        null,
        2,
      ),
    );
    return;
  }

  const auth = await authHeaders();

  const createRes = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets`,
    {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        source: { files: [{ name: 'storage.rules', content }] },
      }),
    },
  );
  const created = await createRes.json();
  if (!createRes.ok || !created.name) {
    throw new Error('Create ruleset failed: ' + JSON.stringify(created));
  }

  // The release id contains a slash, so it has to be encoded in the path.
  const releaseRes = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/${encodeURIComponent(
      releaseId,
    )}`,
    {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({
        release: {
          name: `projects/${PROJECT}/releases/${releaseId}`,
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
        bucket: BUCKET,
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
