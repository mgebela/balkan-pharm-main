/*
 * Public HTTPS proxy for Solana JSON-RPC.
 * Forwards browser requests to SOLANA_RPC_URL (QuickNode/Helius) so the
 * provider key never ships in the frontend bundle.
 *
 * Policy: allow standard wallet/read/send methods by prefix; deny a short
 * blocklist. Denied methods are logged so we can extend safely.
 */
'use strict';

const {verifyAppCheck} = require('./user-guards');

const PUBLIC_FALLBACK = 'https://api.devnet.solana.com';
/** Leave headroom under the Cloud Function's 30s timeout so we return JSON. */
const UPSTREAM_TIMEOUT_MS = 12000;

let warnedPublicFallback = false;

/** Never proxy these — abuse / faucet / admin. */
const DENIED = new Set([
  'requestAirdrop',
  // Rare / unused by wallets; keep closed unless needed.
  'accountSubscribe',
  'accountUnsubscribe',
  'logsSubscribe',
  'logsUnsubscribe',
  'programSubscribe',
  'programUnsubscribe',
  'signatureSubscribe',
  'signatureUnsubscribe',
  'slotSubscribe',
  'slotUnsubscribe',
  'rootSubscribe',
  'rootUnsubscribe',
  'blockSubscribe',
  'blockUnsubscribe',
  'slotsUpdatesSubscribe',
  'slotsUpdatesUnsubscribe',
  'voteSubscribe',
  'voteUnsubscribe',
]);

/**
 * Extra methods that do not match get*|is*|send*|simulate* but wallets use
 * (legacy + niche). Prefer prefix rules for anything new.
 */
const ALLOWED_EXTRA = new Set([
  'minimumLedgerSlot',
  'getConfirmedBlock',
  'getConfirmedBlocks',
  'getConfirmedBlocksWithLimit',
  'getConfirmedSignaturesForAddress2',
  'getConfirmedTransaction',
  'getRecentBlockhash',
  'getFeeCalculatorForBlockhash',
  'getFees',
  'getSnapshotSlot',
]);

function isMethodAllowed(method) {
  if (!method || typeof method !== 'string') return false;
  if (DENIED.has(method)) return false;
  if (ALLOWED_EXTRA.has(method)) return true;
  // Standard Solana HTTP JSON-RPC used by @solana/web3.js + wallets
  if (/^(get|is|send|simulate)[A-Za-z0-9]+$/.test(method)) return true;
  return false;
}

const hits = new Map();

/**
 * Client IP for rate limiting.
 * Clients can prepend spoofed values to X-Forwarded-For; Cloud Run / GCF
 * append the connecting address, so the *rightmost* hop is the trusted one.
 * Never prefer the leftmost XFF value.
 */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const parts = String(forwarded)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  // Express may set req.ip from XFF when trust proxy is on — still better than
  // leftmost spoof. Socket address is the platform edge if nothing else.
  return (
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    (req.raw && req.raw.socket && req.raw.socket.remoteAddress) ||
    'unknown'
  );
}

/** ~180 req/min/IP — wallets poll confirmations aggressively. Per-instance Map. */
function allowRequest(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 180;
  let entry = hits.get(ip);
  if (!entry || now - entry.start > windowMs) {
    entry = {start: now, count: 0};
  }
  entry.count += 1;
  hits.set(ip, entry);
  // Bound map size after cold-start storms
  if (hits.size > 5000) {
    for (const [key, val] of hits) {
      if (now - val.start > windowMs) hits.delete(key);
    }
  }
  return entry.count <= max;
}

function upstreamUrl() {
  const url = (process.env.SOLANA_RPC_URL || '').trim();
  if (!url && !warnedPublicFallback) {
    warnedPublicFallback = true;
    console.warn('solanaRpc SOLANA_RPC_URL unset — using public Devnet fallback');
  }
  return url || PUBLIC_FALLBACK;
}

function isUpstreamTimeout(err) {
  const name = err && err.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function methodOf(body) {
  if (!body || typeof body !== 'object') return null;
  return typeof body.method === 'string' ? body.method : null;
}

function assertAllowed(body) {
  const checkOne = (item) => {
    const m = methodOf(item);
    if (!isMethodAllowed(m)) {
      console.warn('solanaRpc denied method', m || 'unknown');
      const err = new Error('RPC method not allowed: ' + (m || 'unknown'));
      err.status = 403;
      throw err;
    }
  };
  if (Array.isArray(body)) {
    body.forEach(checkOne);
    return;
  }
  checkOne(body);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleSolanaRpc(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {code: -32600, message: 'Only POST JSON-RPC is supported'},
      id: null,
    });
    return;
  }
  if (!allowRequest(req)) {
    res.status(429).json({
      jsonrpc: '2.0',
      error: {code: -32005, message: 'Too many RPC requests'},
      id: null,
    });
    return;
  }

  // This endpoint has no user auth at all — it relays to a paid RPC provider,
  // so App Check is the only thing that can tie a caller to our app. Monitor
  // mode until APP_CHECK_ENFORCE=true; see functions/user-guards.js.
  try {
    await verifyAppCheck(req, 'solanaRpc');
  } catch (err) {
    res.status(err.status || 401).json({
      jsonrpc: '2.0',
      error: {code: -32001, message: err.message || 'Unverified caller'},
      id: null,
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {code: -32700, message: 'Parse error'},
        id: null,
      });
      return;
    }
  }
  if (!body || (typeof body !== 'object' && !Array.isArray(body))) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {code: -32600, message: 'Invalid request'},
      id: null,
    });
    return;
  }

  try {
    assertAllowed(body);
  } catch (err) {
    res.status(err.status || 403).json({
      jsonrpc: '2.0',
      error: {code: -32601, message: err.message},
      id: (body && !Array.isArray(body) && body.id) || null,
    });
    return;
  }

  const target = upstreamUrl();
  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.set('Cache-Control', 'no-store');
    res.send(text);
  } catch (err) {
    const timedOut = isUpstreamTimeout(err);
    if (timedOut) console.warn('solanaRpc upstream timeout', UPSTREAM_TIMEOUT_MS);
    else console.error('solanaRpc upstream', err);
    res.status(timedOut ? 504 : 502).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: timedOut
          ? 'Upstream Solana RPC timed out'
          : 'Upstream Solana RPC failed: ' + ((err && err.message) || 'unknown'),
      },
      id: (body && !Array.isArray(body) && body.id) || null,
    });
  }
}

module.exports = {
  handleSolanaRpc,
  isMethodAllowed,
  clientIp,
  isUpstreamTimeout,
  UPSTREAM_TIMEOUT_MS,
  DENIED,
  ALLOWED_EXTRA,
};
