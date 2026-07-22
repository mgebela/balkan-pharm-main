/*
 * Browser Solana JSON-RPC with multi-endpoint failover.
 * Prefer ChainConfig.rpcUrl (dedicated provider), then rpcUrls fallbacks.
 */
(function () {
  'use strict';

  const DEFAULT_URLS = [
    'https://api.devnet.solana.com',
    'https://rpc.ankr.com/solana_devnet',
    'https://endpoints.omniatech.io/v1/sol/devnet/public',
  ];

  let stickyIndex = 0;

  function endpoints() {
    const cfg = window.ChainConfig || {};
    const list = [];
    if (cfg.rpcUrl) list.push(String(cfg.rpcUrl));
    (cfg.rpcUrls || []).forEach(function (u) {
      if (u) list.push(String(u));
    });
    DEFAULT_URLS.forEach(function (u) {
      list.push(u);
    });
    const seen = {};
    return list.filter(function (u) {
      if (seen[u]) return false;
      seen[u] = true;
      return true;
    });
  }

  function currentUrl() {
    const urls = endpoints();
    if (!urls.length) return 'https://api.devnet.solana.com';
    return urls[stickyIndex % urls.length];
  }

  function rotateUrl() {
    stickyIndex += 1;
    return currentUrl();
  }

  function isRateLimited(res, json) {
    if (res && (res.status === 429 || res.status === 503)) return true;
    const msg = json && json.error && (json.error.message || JSON.stringify(json.error));
    return /429|Too Many Requests|rate limit|capacity|503/i.test(String(msg || ''));
  }

  async function rpc(method, params, options) {
    const opts = options || {};
    const urls = endpoints();
    let lastErr = null;
    const start = stickyIndex % urls.length;

    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[(start + i) % urls.length];
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: method,
            params: params || [],
          }),
        });
        const json = await res.json().catch(function () {
          return null;
        });
        if (!res.ok || isRateLimited(res, json)) {
          lastErr = new Error(
            'RPC ' + res.status + ' from ' + url + (json && json.error ? ': ' + json.error.message : '')
          );
          continue;
        }
        if (json && json.error) {
          lastErr = new Error(json.error.message || JSON.stringify(json.error));
          if (isRateLimited(res, json)) continue;
          throw lastErr;
        }
        stickyIndex = (start + i) % urls.length;
        if (opts.returnFull) return json;
        return json ? json.result : null;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('All Solana RPC endpoints failed for ' + method);
  }

  window.SolanaRpc = {
    endpoints: endpoints,
    currentUrl: currentUrl,
    rotateUrl: rotateUrl,
    rpc: rpc,
  };
})();
