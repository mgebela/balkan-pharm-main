/**
 * Post-transaction health checks (event-driven).
 * Verifies NFT custody / mint consistency right after Firestore status changes
 * that follow a Solana tx (list, buy, cancel, mint).
 */
const {getFirestore} = require('firebase-admin/firestore');

const ESCROW =
  process.env.MARKET_ESCROW_ADDRESS ||
  'EmQ4nNB1YVWNKVEiPNYhLgJR2gY1deJoV2L743z945yD';
const LEGACY_ESCROW =
  process.env.MARKET_LEGACY_ESCROW_ADDRESS ||
  'F6ZEFk81ht6yWKvc5pLYQ5eM6DEKqdN69kbi2hFaMTv3';
const MARKETPLACE_PDA =
  process.env.MARKETPLACE_PDA ||
  '2a887xGdhztkvfHn1BdR5xSkXjunzTG1StdTdtrRddAm';

const PUBLIC_DEVNET_RPCS = [
  'https://api.devnet.solana.com',
  'https://rpc.ankr.com/solana_devnet',
  'https://endpoints.omniatech.io/v1/sol/devnet/public',
];

function rpcEndpoints() {
  const preferred = (process.env.SOLANA_RPC_URL || '').trim();
  const list = [];
  if (preferred) list.push(preferred);
  for (const url of PUBLIC_DEVNET_RPCS) {
    if (!list.includes(url)) list.push(url);
  }
  return list;
}

async function rpc(method, params) {
  const urls = rpcEndpoints();
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
      });
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
      const msg = String((err && err.message) || err);
      if (/429|Too Many|fetch failed|ECONNRESET|ETIMEDOUT|503|abort/i.test(msg)) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('All Solana RPC endpoints failed for ' + method);
}

async function ownerHoldsMint(owner, mintAddress) {
  if (!owner || !mintAddress) return false;
  const result = await rpc('getTokenAccountsByOwner', [
    owner,
    {mint: mintAddress},
    {encoding: 'jsonParsed', commitment: 'confirmed'},
  ]);
  const values = (result && result.value) || [];
  return values.some((a) => {
    const amount =
      a &&
      a.account &&
      a.account.data &&
      a.account.data.parsed &&
      a.account.data.parsed.info &&
      a.account.data.parsed.info.tokenAmount &&
      a.account.data.parsed.info.tokenAmount.amount;
    return Number(amount || 0) >= 1;
  });
}

async function largestTokenOwner(mintAddress) {
  try {
    const result = await rpc('getTokenLargestAccounts', [
      mintAddress,
      {commitment: 'confirmed'},
    ]);
    const values = (result && result.value) || [];
    const top = values.find((v) => Number(v.amount || 0) >= 1);
    if (!top || !top.address) return null;
    const info = await rpc('getAccountInfo', [
      top.address,
      {encoding: 'jsonParsed', commitment: 'confirmed'},
    ]);
    return (
      (info &&
        info.value &&
        info.value.data &&
        info.value.data.parsed &&
        info.value.data.parsed.info &&
        info.value.data.parsed.info.owner) ||
      null
    );
  } catch {
    return null;
  }
}

function custodyOwnersForListing(data) {
  const owners = new Set();
  if (data.settlement === 'program' && data.listingPda) {
    owners.add(String(data.listingPda));
  }
  owners.add(ESCROW);
  owners.add(LEGACY_ESCROW);
  owners.add(MARKETPLACE_PDA);
  if (data.careEscrowAddress) owners.add(String(data.careEscrowAddress));
  return [...owners];
}

/**
 * @returns {Promise<{ok:boolean, status:string, issues:object[], actualOwner:?string, expectedOwners:string[]}>}
 */
async function verifyListingCustody(data) {
  const status = String(data.status || '');
  const issues = [];
  const mintAddress = data.mintAddress || null;

  if (!mintAddress) {
    return {
      ok: false,
      status,
      issues: [{kind: 'missing_mint', message: 'Listing has no mintAddress'}],
      actualOwner: null,
      expectedOwners: [],
    };
  }

  // Fresh escrow_pending: transfer may still be confirming — skip hard fail.
  if (status === 'escrow_pending') {
    return {
      ok: true,
      status,
      issues: [],
      actualOwner: null,
      expectedOwners: custodyOwnersForListing(data),
      skipped: 'escrow_pending_confirming',
    };
  }

  if (status === 'active' || status === 'sale_pending' || status === 'cancel_requested') {
    const expected = custodyOwnersForListing(data);
    let heldBy = null;
    for (const owner of expected) {
      if (await ownerHoldsMint(owner, mintAddress)) {
        heldBy = owner;
        break;
      }
    }
    if (!heldBy) {
      const actualOwner = await largestTokenOwner(mintAddress);
      issues.push({
        kind: 'token_dispute',
        message: 'NFT not in expected escrow / listing vault',
        actualOwner: actualOwner || 'unknown',
        sellerStillHolds: !!(data.sellerPubkey && actualOwner === data.sellerPubkey),
      });
      return {ok: false, status, issues, actualOwner, expectedOwners: expected};
    }
    return {
      ok: true,
      status,
      issues: [],
      actualOwner: heldBy,
      expectedOwners: expected,
    };
  }

  if (status === 'sold') {
    const buyer = data.buyerPubkey || null;
    if (!buyer) {
      issues.push({kind: 'sold_missing_buyer', message: 'Sold listing missing buyerPubkey'});
      return {ok: false, status, issues, actualOwner: null, expectedOwners: []};
    }
    const held = await ownerHoldsMint(buyer, mintAddress);
    if (!held) {
      const actualOwner = await largestTokenOwner(mintAddress);
      // Still in vault? settle may be mid-flight for legacy paths.
      const stillVault = await (async () => {
        for (const o of custodyOwnersForListing(data)) {
          if (await ownerHoldsMint(o, mintAddress)) return o;
        }
        return null;
      })();
      issues.push({
        kind: 'sold_buyer_missing_nft',
        message: 'Sold listing but buyer does not hold NFT',
        actualOwner: actualOwner || 'unknown',
        stillInVault: stillVault,
      });
      return {
        ok: false,
        status,
        issues,
        actualOwner,
        expectedOwners: [buyer],
      };
    }
    return {
      ok: true,
      status,
      issues: [],
      actualOwner: buyer,
      expectedOwners: [buyer],
    };
  }

  return {
    ok: true,
    status,
    issues: [],
    actualOwner: null,
    expectedOwners: [],
    skipped: 'status_not_checked',
  };
}

async function verifyMintDoc(data) {
  const status = String(data.status || '');
  const issues = [];
  if (status === 'failed') {
    issues.push({
      kind: 'mint_failed',
      message: data.error || 'Mint marked failed',
    });
    return {ok: false, status, issues};
  }
  if (status !== 'minted') {
    return {ok: true, status, issues: [], skipped: 'not_minted_yet'};
  }
  const mintAddress = data.mintAddress;
  if (!mintAddress) {
    return {
      ok: false,
      status,
      issues: [{kind: 'minted_missing_address', message: 'minted without mintAddress'}],
    };
  }
  const expectedOwner = data.owner || data.recipient || null;
  if (!expectedOwner) {
    return {ok: true, status, issues: [], mintAddress, skipped: 'no_owner_field'};
  }
  const held = await ownerHoldsMint(expectedOwner, mintAddress);
  if (!held) {
    const actualOwner = await largestTokenOwner(mintAddress);
    issues.push({
      kind: 'mint_owner_mismatch',
      message: 'Minted NFT not held by expected recipient',
      expectedOwner,
      actualOwner: actualOwner || 'unknown',
    });
    return {ok: false, status, issues, mintAddress, actualOwner, expectedOwner};
  }
  return {ok: true, status, issues: [], mintAddress, actualOwner: expectedOwner};
}

async function persistHealth(ref, result, trigger) {
  const payload = {
    txHealth: {
      ok: !!result.ok,
      checkedAt: new Date().toISOString(),
      trigger: trigger || 'firestore',
      status: result.status || null,
      issues: result.issues || [],
      actualOwner: result.actualOwner || null,
      expectedOwners: result.expectedOwners || null,
      skipped: result.skipped || null,
    },
  };
  await ref.set(payload, {merge: true});

  if (!result.ok && (result.issues || []).length) {
    const db = getFirestore();
    await db.collection('opsHealthEvents').add({
      source: trigger || 'firestore',
      collection: ref.parent.id,
      docId: ref.id,
      ok: false,
      issues: result.issues,
      status: result.status || null,
      createdAt: new Date().toISOString(),
    });
  }
}

/**
 * Run after a marketListings write when status changed.
 */
async function onMarketListingChange(before, after, ref) {
  const prev = before || {};
  const next = after || {};
  if (!next.status) return null;
  // Ignore our own health-field writes.
  if (prev.status === next.status && next.txHealth) return null;
  if (prev.status === next.status) return null;

  // Small settle delay so RPC sees the confirmed token account.
  await new Promise((r) => setTimeout(r, 2500));
  const fresh = (await ref.get()).data() || next;
  const result = await verifyListingCustody(fresh);
  await persistHealth(ref, result, 'marketListings:' + (prev.status || 'new') + '→' + next.status);
  console.log('txHealth listing', ref.id, result.ok, result.issues);
  return result;
}

async function onMintDocChange(before, after, ref, kind) {
  const prev = before || {};
  const next = after || {};
  if (!next.status || prev.status === next.status) return null;
  if (next.status !== 'minted' && next.status !== 'failed') return null;

  await new Promise((r) => setTimeout(r, 2000));
  const fresh = (await ref.get()).data() || next;
  const result = await verifyMintDoc(fresh);
  await persistHealth(ref, result, kind + ':' + (prev.status || 'new') + '→' + next.status);
  console.log('txHealth', kind, ref.id, result.ok, result.issues);
  return result;
}

module.exports = {
  verifyListingCustody,
  verifyMintDoc,
  onMarketListingChange,
  onMintDocChange,
  persistHealth,
};
