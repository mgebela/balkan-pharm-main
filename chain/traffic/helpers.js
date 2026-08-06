/**
 * Shared Admin helpers for traffic seed / day / wipe.
 * Auth uses Identity Toolkit REST (avoids firebase-admin/auth + jose ESM break).
 */
import fs from 'node:fs';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';
import { initFirestore, SERVICE_ACCOUNT_PATH, PROJECT_ID } from '../firebase.js';
import { KEYS_DIR } from '../common.js';
import { TRAFFIC_BATCH, TRAFFIC_PASSWORD, allPersonas } from './personas.js';
import { trafficPubkey } from './synth.js';

export const CREDS_PATH = path.join(KEYS_DIR, 'traffic-agents.json');

let cachedToken = null;
let cachedTokenExp = 0;

export function initTraffic() {
  const db = initFirestore();
  return { db };
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExp - 60_000) return cachedToken;
  const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/firebase',
      'https://www.googleapis.com/auth/identitytoolkit',
    ],
  });
  const client = await auth.getClient();
  const res = await client.getAccessToken();
  if (!res || !res.token) throw new Error('Failed to obtain Google access token for Identity Toolkit');
  cachedToken = res.token;
  cachedTokenExp = now + 50 * 60 * 1000;
  return cachedToken;
}

async function identityToolkit(methodPath, body) {
  const token = await getAccessToken();
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}${methodPath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json.error?.message || text.slice(0, 400);
    const err = new Error(`Identity Toolkit ${methodPath} → ${res.status}: ${msg}`);
    err.code = json.error?.message || String(res.status);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

export async function ensureAuthUser(_unused, persona) {
  const email = persona.email;
  let localId = null;

  try {
    const looked = await identityToolkit('/accounts:lookup', { email: [email] });
    const users = looked.users || [];
    if (users.length) localId = users[0].localId;
  } catch (err) {
    // USER_NOT_FOUND is returned as 200 with empty users sometimes; other errors bubble
    if (!String(err.code || '').includes('USER_NOT_FOUND') && err.status !== 400) {
      // lookup with unknown email often returns { users: [] } — continue
    }
  }

  if (localId) {
    await identityToolkit('/accounts:update', {
      localId,
      email,
      password: TRAFFIC_PASSWORD,
      displayName: persona.displayName,
      emailVerified: true,
      disableUser: false,
    });
    return { uid: localId, email };
  }

  const created = await identityToolkit('/accounts', {
    email,
    password: TRAFFIC_PASSWORD,
    displayName: persona.displayName,
    emailVerified: true,
  });
  if (!created.localId) throw new Error('Identity Toolkit create returned no localId for ' + email);
  return { uid: created.localId, email };
}

export async function deleteAuthUser(uid) {
  await identityToolkit('/accounts:delete', { localId: uid });
}

export function userProfilePayload(persona, uid) {
  const pubkey =
    persona.profileType === 'grower'
      ? trafficPubkey(`seller:${persona.key}`)
      : trafficPubkey(`buyer:${persona.key}`);
  const base = {
    email: persona.email,
    displayName: persona.displayName,
    profileType: persona.profileType,
    role: 'user',
    chainOptIn: true,
    chainOptInAt: new Date().toISOString(),
    solanaPubkey: pubkey,
    trafficAgent: true,
    trafficBatch: TRAFFIC_BATCH,
    trafficKey: persona.key,
    updatedAt: new Date().toISOString(),
  };
  if (persona.profileType === 'grower') {
    base.growerNotes = persona.notes || '';
    base.personality = persona.personality || '';
    base.declaredPlants = persona.declaredPlants;
    if (persona.declaredHectares != null) base.declaredHectares = persona.declaredHectares;
    base.environmentName = persona.environmentName;
    base.city = persona.city || null;
    base.region = persona.region || null;
    base.country = persona.country || 'Croatia';
    base.firstName = persona.firstName || null;
    if (persona.journalSkill) base.journalSkill = persona.journalSkill;
    if (persona.profilePhoto) base.profilePhoto = persona.profilePhoto;
  } else {
    base.adopterIntent = persona.adopterIntent || 'support_growers';
    base.adopterTier = persona.tier;
    if (persona.coachNeeds) base.coachNeeds = persona.coachNeeds;
  }
  return { ...base, uid };
}

export async function commitBatches(db, writes) {
  const CHUNK = 400;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const slice = writes.slice(i, i + CHUNK);
    const batch = db.batch();
    slice.forEach(({ ref, data, merge }) => {
      if (merge) batch.set(ref, data, { merge: true });
      else batch.set(ref, data);
    });
    await batch.commit();
  }
}

export async function deleteQueryInChunks(db, query, label) {
  let total = 0;
  for (;;) {
    const snap = await query.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    console.log(`  … deleted ${total} ${label}`);
    if (snap.size < 400) break;
  }
  return total;
}

export function writeCredsFile(accounts) {
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });
  const payload = {
    batch: TRAFFIC_BATCH,
    password: TRAFFIC_PASSWORD,
    writtenAt: new Date().toISOString(),
    note: 'Sim traffic agents for UX — not real Devnet mints. Sign in on growto.live with email/password.',
    accounts,
  };
  fs.writeFileSync(CREDS_PATH, JSON.stringify(payload, null, 2));
  return CREDS_PATH;
}

export function readCredsFile() {
  if (!fs.existsSync(CREDS_PATH)) return null;
  return JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
}

export { SERVICE_ACCOUNT_PATH, allPersonas, TRAFFIC_BATCH, TRAFFIC_PASSWORD };
