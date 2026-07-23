/*
 * Public HTTPS proxy for Solana JSON-RPC.
 * Forwards browser requests to SOLANA_RPC_URL (QuickNode/Helius) so the
 * provider key never ships in the frontend bundle.
 */
'use strict';

const PUBLIC_FALLBACK = 'https://api.devnet.solana.com';

/** Methods wallets / market UI commonly need. Deny airdrop (not for browsers). */
const ALLOWED = new Set([
  'getAccountInfo',
  'getBalance',
  'getBlockHeight',
  'getBlockTime',
  'getEpochInfo',
  'getFeeForMessage',
  'getGenesisHash',
  'getHealth',
  'getLatestBlockhash',
  'getMinimumBalanceForRentExemption',
  'getMultipleAccounts',
  'getProgramAccounts',
  'getRecentPerformanceSamples',
  'getRecentPrioritizationFees',
  'getSignatureStatuses',
  'getSignaturesForAddress',
  'getSlot',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
  'getTokenLargestAccounts',
  'getTokenSupply',
  'getTransaction',
  'getTransactionCount',
  'getVersion',
  'isBlockhashValid',
  'sendTransaction',
  'simulateTransaction',
  'getConfirmedSignaturesForAddress2',
  'getConfirmedTransaction',
  'getRecentBlockhash',
]);

const hits = new Map();

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (
    (forwarded && String(forwarded).split(',')[0].trim()) ||
    req.ip ||
    'unknown'
  );
}

/** ~180 req/min/IP — wallets poll confirmations aggressively. */
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
  return entry.count <= max;
}

function upstreamUrl() {
  const url = (process.env.SOLANA_RPC_URL || '').trim();
  return url || PUBLIC_FALLBACK;
}

function methodOf(body) {
  if (!body || typeof body !== 'object') return null;
  return typeof body.method === 'string' ? body.method : null;
}

function assertAllowed(body) {
  if (Array.isArray(body)) {
    for (const item of body) {
      const m = methodOf(item);
      if (!m || !ALLOWED.has(m)) {
        const err = new Error('RPC method not allowed: ' + (m || 'unknown'));
        err.status = 403;
        throw err;
      }
    }
    return;
  }
  const m = methodOf(body);
  if (!m || !ALLOWED.has(m)) {
    const err = new Error('RPC method not allowed: ' + (m || 'unknown'));
    err.status = 403;
    throw err;
  }
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
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
    // Hint caches / browsers: RPC is not cacheable.
    res.set('Cache-Control', 'no-store');
    res.send(text);
  } catch (err) {
    console.error('solanaRpc upstream', err);
    res.status(502).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Upstream Solana RPC failed: ' + ((err && err.message) || 'unknown'),
      },
      id: (body && !Array.isArray(body) && body.id) || null,
    });
  }
}

module.exports = {handleSolanaRpc, ALLOWED};
