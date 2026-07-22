/*
 * Solana Devnet RPC endpoint list + failover helpers for chain workers.
 * Prefer SOLANA_RPC_URL (Helius/QuickNode). Fall back across public endpoints.
 */
export const PUBLIC_DEVNET_RPCS = [
  'https://api.devnet.solana.com',
  'https://rpc.ankr.com/solana_devnet',
  'https://endpoints.omniatech.io/v1/sol/devnet/public',
];

export function rpcEndpoints() {
  const preferred = (process.env.SOLANA_RPC_URL || '').trim();
  const list = [];
  if (preferred) list.push(preferred);
  for (const url of PUBLIC_DEVNET_RPCS) {
    if (!list.includes(url)) list.push(url);
  }
  return list;
}

/** Primary endpoint (env preferred). Umi/Connection use this at startup. */
export const RPC_URL = rpcEndpoints()[0];

/**
 * JSON-RPC with endpoint rotation on 429 / transport errors.
 * @param {string} method
 * @param {unknown[]} params
 * @param {{timeoutMs?: number}} [opts]
 */
export async function rpcFetch(method, params = [], opts = {}) {
  const timeoutMs = opts.timeoutMs || 20000;
  const urls = rpcEndpoints();
  let lastErr = null;

  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const json = await res.json();
      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`RPC ${res.status} from ${url}`);
        continue;
      }
      if (json.error) {
        const msg = json.error.message || JSON.stringify(json.error);
        if (/429|Too Many Requests|rate limit|capacity/i.test(msg)) {
          lastErr = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }
      return json.result;
    } catch (err) {
      lastErr = err;
      const msg = String(err && err.message ? err.message : err);
      if (/abort|fetch failed|ECONNRESET|ETIMEDOUT|429|Too Many/i.test(msg)) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('All Solana RPC endpoints failed for ' + method);
}
