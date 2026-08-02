/*
 * Server-side Solana wallet link: verify ed25519 signature of a challenge
 * message, enforce pubkey uniqueness, write users/{uid} via Admin SDK.
 */
'use strict';

const nacl = require('tweetnacl');
const bs58 = require('bs58');
const {getAuth} = require('firebase-admin/auth');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');

const MAX_MESSAGE_AGE_MS = 15 * 60 * 1000;
const DOMAIN_LINE = 'Domain: growto.live';

function isValidPubkey(pk) {
  if (typeof pk !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pk)) {
    return false;
  }
  try {
    const bytes = bs58.decode(pk);
    return bytes.length === 32;
  } catch (_) {
    return false;
  }
}

function decodeSignature(raw) {
  if (!raw) throw new Error('Missing signature.');
  if (Array.isArray(raw)) {
    return Uint8Array.from(raw);
  }
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.data)) return Uint8Array.from(raw.data);
    if (raw.type === 'Buffer' && Array.isArray(raw.data)) {
      return Uint8Array.from(raw.data);
    }
  }
  if (typeof raw !== 'string') {
    throw new Error('Signature must be base58, base64, or byte array.');
  }
  const s = raw.trim();
  // Prefer base58 (Solana wallets often return this via bs58 of Uint8Array).
  try {
    const b58 = bs58.decode(s);
    if (b58.length === 64) return new Uint8Array(b58);
  } catch (_) {
    /* try base64 */
  }
  try {
    const b64 = Buffer.from(s, 'base64');
    if (b64.length === 64) return new Uint8Array(b64);
  } catch (_) {
    /* fall through */
  }
  throw new Error('Could not decode signature (need 64-byte ed25519 sig).');
}

function parseIssuedMs(message) {
  const m = String(message || '').match(/^Issued:\s*(\S+)/m);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : null;
}

function assertMessageMatches(message, uid, pubkey) {
  const text = String(message || '');
  if (!text.includes('Link this Solana wallet to your growtoo account.')) {
    throw new Error('Unexpected link message preamble.');
  }
  if (!text.includes(DOMAIN_LINE)) {
    throw new Error('Link message must include Domain: growto.live');
  }
  if (!text.includes('UID: ' + uid)) {
    throw new Error('Link message UID does not match the signed-in user.');
  }
  if (!text.includes('Wallet: ' + pubkey)) {
    throw new Error('Link message wallet does not match claimed pubkey.');
  }
  if (!text.includes('Cluster: devnet')) {
    throw new Error('Link message must declare Cluster: devnet.');
  }
  const issued = parseIssuedMs(text);
  if (issued == null) throw new Error('Link message missing Issued timestamp.');
  const age = Date.now() - issued;
  if (age < -60 * 1000 || age > MAX_MESSAGE_AGE_MS) {
    throw new Error('Link message expired. Request a new signature.');
  }
}

function verifyEd25519(message, signatureRaw, pubkey) {
  const msg = new TextEncoder().encode(String(message));
  const sig = decodeSignature(signatureRaw);
  const key = bs58.decode(pubkey);
  if (key.length !== 32) throw new Error('Invalid Solana pubkey length.');
  if (sig.length !== 64) throw new Error('Invalid signature length.');
  if (!nacl.sign.detached.verify(msg, sig, key)) {
    throw new Error('Signature does not match the claimed wallet pubkey.');
  }
}

async function assertPubkeyUnique(db, pubkey, uid) {
  const snap = await db
      .collection('users')
      .where('solanaPubkey', '==', pubkey)
      .limit(5)
      .get();
  for (const doc of snap.docs) {
    if (doc.id !== uid) {
      const err = new Error(
          'That wallet is already linked to another growtoo account.',
      );
      err.status = 409;
      throw err;
    }
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleLinkWallet(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ok: false, error: 'Method not allowed'});
    return;
  }

  try {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer (.+)$/i);
    if (!match) {
      res.status(401).json({ok: false, error: 'Missing Authorization Bearer token'});
      return;
    }
    const decoded = await getAuth().verifyIdToken(match[1]);
    const uid = decoded.uid;

    const body = req.body || {};
    const pubkey = String(body.pubkey || body.solanaPubkey || '').trim();
    const walletProvider = String(body.walletProvider || 'solana').trim().slice(0, 64);
    const mode = String(body.mode || 'verified').trim();
    const watchOnly = mode === 'watch-only' || walletProvider === 'watch-only';

    if (!isValidPubkey(pubkey)) {
      res.status(400).json({ok: false, error: 'Invalid Solana wallet address.'});
      return;
    }

    const db = getFirestore();
    await assertPubkeyUnique(db, pubkey, uid);

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(400).json({ok: false, error: 'User profile not found.'});
      return;
    }
    const existing = userSnap.data() || {};
    const existingPk = String(existing.solanaPubkey || '');
    if (existingPk && existingPk !== pubkey && !body.force) {
      res.status(409).json({
        ok: false,
        error:
          'A different wallet is already linked to this account. Disconnect first to change it.',
      });
      return;
    }

    const now = new Date().toISOString();
    let patch;

    if (watchOnly) {
      // Explicit unverified path — never accept a client-claimed "verified" flag.
      patch = {
        solanaPubkey: pubkey,
        walletProvider: 'watch-only',
        walletLinkedAt: now,
        walletVerified: false,
        walletLinkSignature: FieldValue.delete(),
        walletLinkMessage: FieldValue.delete(),
      };
    } else {
      const message = String(body.message || '');
      const signature = body.signature;
      if (!message || signature == null) {
        res.status(400).json({
          ok: false,
          error: 'message and signature are required for a verified wallet link.',
        });
        return;
      }
      assertMessageMatches(message, uid, pubkey);
      verifyEd25519(message, signature, pubkey);

      patch = {
        solanaPubkey: pubkey,
        walletProvider: walletProvider || 'solana',
        walletLinkedAt: now,
        walletVerified: true,
        walletLinkMessage: message.slice(0, 500),
        walletLinkSignature: typeof signature === 'string'
          ? signature.slice(0, 128)
          : 'bytes',
      };
    }

    await userRef.set(patch, {merge: true});

    res.json({
      ok: true,
      solanaPubkey: pubkey,
      walletProvider: patch.walletProvider,
      walletLinkedAt: now,
      walletVerified: !!patch.walletVerified,
    });
  } catch (err) {
    const status = err.status || (err.code === 'auth/id-token-expired' ? 401 : 400);
    console.error('linkWallet', err && err.message);
    res.status(status).json({
      ok: false,
      error: (err && err.message) || 'Wallet link failed',
    });
  }
}

module.exports = {
  handleLinkWallet,
  isValidPubkey,
  verifyEd25519,
  assertMessageMatches,
};
