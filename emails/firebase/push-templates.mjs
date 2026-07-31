#!/usr/bin/env node
/**
 * Set Auth email sender display name to "growtoo" (API allows this).
 * Subject + HTML body must still be pasted in Firebase Console — see PASTE.txt.
 *
 * Usage: NODE_PATH=chain/node_modules node emails/firebase/push-templates.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleAuth } from 'google-auth-library';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SA_PATH = path.join(ROOT, 'chain/keys/firebase-service-account.json');
const PROJECT = 'balpha-9dab9';
const CONFIG_URL = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;

const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
const auth = new GoogleAuth({
  credentials: sa,
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/identitytoolkit',
  ],
});
const client = await auth.getClient();
const { token } = await client.getAccessToken();

const mask = [
  'notification.sendEmail.verifyEmailTemplate.senderDisplayName',
  'notification.sendEmail.resetPasswordTemplate.senderDisplayName',
  'notification.sendEmail.changeEmailTemplate.senderDisplayName',
].join(',');

const res = await fetch(`${CONFIG_URL}?updateMask=${encodeURIComponent(mask)}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    notification: {
      sendEmail: {
        verifyEmailTemplate: { senderDisplayName: 'growtoo' },
        resetPasswordTemplate: { senderDisplayName: 'growtoo' },
        changeEmailTemplate: { senderDisplayName: 'growtoo' },
      },
    },
  }),
});

if (!res.ok) {
  console.error('PATCH failed', res.status, await res.text());
  process.exit(1);
}

const get = await fetch(CONFIG_URL, {
  headers: { Authorization: `Bearer ${token}` },
});
const email = (await get.json()).notification?.sendEmail || {};
for (const key of [
  'verifyEmailTemplate',
  'resetPasswordTemplate',
  'changeEmailTemplate',
]) {
  const t = email[key] || {};
  console.log(key, '→ from:', t.senderDisplayName, '| subject:', t.subject);
}
console.log('OK: sender display name set.');
console.log('Paste subjects + bodies from emails/firebase/PASTE.txt in the Console.');
console.log('https://console.firebase.google.com/project/balpha-9dab9/authentication/emails');
