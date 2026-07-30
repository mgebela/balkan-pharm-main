const {onRequest} = require('firebase-functions/v2/https');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {onDocumentWritten} = require('firebase-functions/v2/firestore');
const {defineSecret} = require('firebase-functions/params');
const {initializeApp} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {GoogleGenAI} = require('@google/genai');
const {reconcileEscrowPending, setPreferredRpc} = require('./market-reconcile');
const {settleMarketPending} = require('./market-settle');
const {handleSolanaRpc} = require('./solana-rpc-proxy');
const {
  onMarketListingChange,
  onMintDocChange,
  verifyListingCustody,
  verifyMintDoc,
  persistHealth,
} = require('./tx-health');
const {getFirestore} = require('firebase-admin/firestore');

initializeApp();

// Set after: firebase functions:secrets:set GEMINI_API_KEY
const geminiApiKey = defineSecret('GEMINI_API_KEY');

const REGION = 'europe-west1';

/** Simple in-memory rate limit for the public reconcile HTTP endpoint. */
const reconcileHits = new Map();
function allowReconcileRequest(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    (forwarded && String(forwarded).split(',')[0].trim()) ||
    req.ip ||
    'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 12;
  let entry = reconcileHits.get(ip);
  if (!entry || now - entry.start > windowMs) {
    entry = {start: now, count: 0};
  }
  entry.count += 1;
  reconcileHits.set(ip, entry);
  return entry.count <= max;
}

const COACH_SYSTEM = `You are the growtoo Grower Coach — a practical CBD/hemp cultivation and tokenisation assistant that can PROPOSE app actions.

Audience: growers using the growtoo journal who can mint Seed RWAs on Solana (devnet).

Journal stages (Croatian keys → English):
- klijanje = Germination
- sadnica = Seedling
- vegetativna = Vegetative
- cvjetanje = Flowering
- susenje = Drying / harvest prep

Token growth stages: seed → germination → seedling → vegetative → flowering → harvest.
Growth mints need journal proof: linked plant, stage log, watering, and feeding (feeding optional only for germination).

When the grower asks you to DO something (create a plant, log watering/feeding, change stage, mint a seed, mint growth, link plant), include structured actions.

ALWAYS reply with ONLY valid JSON (no markdown fences):
{
  "reply": "short human message explaining what you will do or advising",
  "actions": [
    // optional; omit or [] when advice-only
  ]
}

Allowed action types:
1) {"type":"create_plant","name":"string","strain":"string?","stage":"klijanje|sadnica|vegetativna|cvjetanje|susenje?","environmentType":"indoor|outdoor?"}
2) {"type":"add_entry","plantId":"id OR plant name","entryType":"zalijevanje|gnojidba|opcenito|faza|okolis","note":"string?","date":"YYYY-MM-DD?"}
3) {"type":"set_stage","plantId":"id OR plant name","stage":"klijanje|sadnica|vegetativna|cvjetanje|susenje","note":"string?"}
4) {"type":"import_seed","plantId":"id OR plant name","name":"string?","batch":"string?"}
5) {"type":"mint_growth","tokenId":"optional token id","plantId":"optional plant id/name to find token"}
6) {"type":"link_plant","tokenId":"token id","plantId":"id OR plant name"}

Rules:
- Prefer plant names from the journal snapshot when resolving plants.
- Never invent plantIds that are not in context unless creating a new plant first.
- Max 5 actions per response.
- Destructive deletes are NOT allowed.
- Be concise. Reply language: match the user (default English; Croatian if they write Croatian).
- If the request is unclear, ask one clarifying question with actions:[].`;


/**
 * Health check — verify deploy works before wiring Gemini.
 * GET https://<region>-<project>.cloudfunctions.net/healthCheck
 */
exports.healthCheck = onRequest({region: REGION, invoker: 'public'}, (req, res) => {
  res.json({ok: true, service: 'dnevnik-live-functions'});
});

/**
 * Browser → QuickNode/Helius JSON-RPC proxy (SOLANA_RPC_URL stays server-side).
 * POST https://europe-west1-balpha-9dab9.cloudfunctions.net/solanaRpc
 */
exports.solanaRpc = onRequest(
    {
      region: REGION,
      cors: true,
      invoker: 'public',
      timeoutSeconds: 30,
      memory: '256MiB',
      maxInstances: 10,
    },
    handleSolanaRpc,
);

/**
 * Activate escrow_pending listings once the NFT is confirmed in escrow.
 * Safe to call repeatedly (idempotent). Used by:
 *   - Cloud Scheduler (every 5 minutes)
 *   - GitHub Actions cron
 *   - App market view auto-ping
 *
 * POST/GET https://europe-west1-balpha-9dab9.cloudfunctions.net/reconcileMarketEscrow
 */
exports.reconcileMarketEscrow = onRequest(
    {
      region: REGION,
      cors: true,
      invoker: 'public',
      timeoutSeconds: 120,
      memory: '256MiB',
      maxInstances: 2,
    },
    async (req, res) => {
      if (!allowReconcileRequest(req)) {
        res.status(429).json({ok: false, error: 'Too many reconcile requests'});
        return;
      }
      try {
        // Optional: set Cloud Run env SOLANA_RPC_URL to a Helius/QuickNode Devnet URL.
        setPreferredRpc(process.env.SOLANA_RPC_URL || '');
        const result = await reconcileEscrowPending();
        res.json({ok: true, ...result});
      } catch (err) {
        console.error('reconcileMarketEscrow', err);
        res.status(500).json({ok: false, error: (err && err.message) || 'reconcile failed'});
      }
    },
);

/**
 * Scheduled backup so listings never sit in "Escrow confirming…" for hours
 * when the NFT already landed in the escrow wallet.
 */
exports.reconcileMarketEscrowSchedule = onSchedule(
    {
      schedule: 'every 5 minutes',
      region: REGION,
      timeoutSeconds: 120,
      memory: '256MiB',
    },
    async () => {
      setPreferredRpc(process.env.SOLANA_RPC_URL || '');
      const result = await reconcileEscrowPending();
      console.log('scheduled reconcile', result);
    },
);

/**
 * Settle sale_pending / cancel_requested without a laptop.
 * Uses fee-payer + escrow (+ mint authority for legacy holdings).
 *
 * POST/GET https://europe-west1-balpha-9dab9.cloudfunctions.net/settleMarketQueue
 */
exports.settleMarketQueue = onRequest(
    {
      region: REGION,
      cors: true,
      invoker: 'public',
      timeoutSeconds: 300,
      memory: '512MiB',
      maxInstances: 2,
    },
    async (req, res) => {
      if (!allowReconcileRequest(req)) {
        res.status(429).json({ok: false, error: 'Too many settle requests'});
        return;
      }
      try {
        const result = await settleMarketPending();
        res.json(result);
      } catch (err) {
        console.error('settleMarketQueue', err);
        res.status(500).json({ok: false, error: (err && err.message) || 'settle failed'});
      }
    },
);

/** Backup scheduler so buys/cancels do not wait on GitHub Actions alone. */
exports.settleMarketQueueSchedule = onSchedule(
    {
      schedule: 'every 5 minutes',
      region: REGION,
      timeoutSeconds: 300,
      memory: '512MiB',
    },
    async () => {
      const result = await settleMarketPending();
      console.log('scheduled market settle', result);
    },
);

/**
 * Analyze 1–2 JPEG frames from a grow video and return a text report.
 * POST { frames: string[], plantName?, stage?, locale? }
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Deploy with secret:
 *   firebase functions:secrets:set GEMINI_API_KEY
 *   firebase deploy --only functions:analyzeGrowFrames
 */
exports.analyzeGrowFrames = onRequest(
    {
      region: REGION,
      secrets: [geminiApiKey],
      cors: true,
      invoker: 'public',
      maxInstances: 10,
      timeoutSeconds: 60,
      memory: '512MiB',
    },
    async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
      }
      if (req.method !== 'POST') {
        res.status(405).json({error: 'Method not allowed'});
        return;
      }

      try {
        const authHeader = req.headers.authorization || '';
        const match = authHeader.match(/^Bearer (.+)$/i);
        if (!match) {
          res.status(401).json({error: 'Missing Authorization Bearer token'});
          return;
        }
        await getAuth().verifyIdToken(match[1]);

        const {frames, plantName, stage, locale} = req.body || {};
        if (!Array.isArray(frames) || frames.length === 0 || frames.length > 2) {
          res.status(400).json({error: 'Provide 1–2 base64 JPEG frames in `frames`'});
          return;
        }

        const apiKey = geminiApiKey.value();
        if (!apiKey) {
          res.status(503).json({error: 'GEMINI_API_KEY secret not configured'});
          return;
        }

        const genAI = new GoogleGenAI({apiKey});

        const lang = locale === 'en' ? 'English' : 'Croatian';
        const context = [
          plantName ? `Plant: ${plantName}` : null,
          stage ? `Growth stage: ${stage}` : null,
        ]
            .filter(Boolean)
            .join('. ');

        const prompt = `You are a grow journal assistant for cannabis/CBD cultivation.
Analyze the plant photo(s) from a grow video frame.
${context ? `Context: ${context}.` : ''}
Write in ${lang}.
Return ONLY valid JSON (no markdown fences) with keys:
summary (string, 2-4 sentences),
observations (string array, 3-6 items),
suggestedActions (string array, 2-4 items),
plantHealth ("good" | "watch" | "concern").
Do not invent details not visible in the images.`;

        const parts = [{text: prompt}];
        for (const frame of frames) {
          const m = String(frame).match(/^data:(image\/\w+);base64,(.+)$/);
          if (!m) {
            res.status(400).json({error: 'Each frame must be a data:image/...;base64,... URL'});
            return;
          }
          parts.push({inlineData: {mimeType: m[1], data: m[2]}});
        }

        const result = await genAI.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: parts,
        });
        const text = result.text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          res.status(502).json({error: 'Model did not return JSON', raw: text.slice(0, 500)});
          return;
        }

        const report = JSON.parse(jsonMatch[0]);
        res.json(report);
      } catch (err) {
        console.error('analyzeGrowFrames', err);
        const code = err.code === 'auth/id-token-expired' ? 401 : 500;
        res.status(code).json({error: err.message || 'Internal error'});
      }
    },
);

/**
 * Grower coach chat — journal + cultivation + tokenisation guidance.
 * POST {
 *   message: string,
 *   history?: { role: 'user'|'assistant', content: string }[],
 *   context?: object,
 *   locale?: string
 * }
 * Header: Authorization: Bearer <Firebase ID token>
 */
exports.coachChat = onRequest(
    {
      region: REGION,
      secrets: [geminiApiKey],
      cors: true,
      invoker: 'public',
      maxInstances: 20,
      timeoutSeconds: 60,
      memory: '512MiB',
    },
    async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
      }
      if (req.method !== 'POST') {
        res.status(405).json({error: 'Method not allowed'});
        return;
      }

      try {
        const authHeader = req.headers.authorization || '';
        const match = authHeader.match(/^Bearer (.+)$/i);
        if (!match) {
          res.status(401).json({error: 'Missing Authorization Bearer token'});
          return;
        }
        await getAuth().verifyIdToken(match[1]);

        const body = req.body || {};
        const message = String(body.message || '').trim();
        if (!message || message.length > 4000) {
          res.status(400).json({error: 'Provide a message (1–4000 chars)'});
          return;
        }

        const apiKey = geminiApiKey.value();
        if (!apiKey) {
          res.status(503).json({error: 'GEMINI_API_KEY secret not configured'});
          return;
        }

        const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
        const context = body.context && typeof body.context === 'object' ? body.context : {};
        const locale = body.locale === 'hr' ? 'hr' : 'en';

        const contextBlock = [
          'Grower journal snapshot (JSON):',
          JSON.stringify(context).slice(0, 6000),
          locale === 'hr' ? 'Prefer Croatian replies.' : 'Prefer English replies.',
        ].join('\n');

        const contents = [
          {role: 'user', parts: [{text: COACH_SYSTEM + '\n\n' + contextBlock}]},
          {
            role: 'model',
            parts: [{
              text: '{"reply":"Ready. I will guide growth steps and propose journal/token actions as JSON when you ask me to do something.","actions":[]}',
            }],
          },
        ];

        history.forEach((turn) => {
          if (!turn || !turn.content) return;
          const role = turn.role === 'assistant' ? 'model' : 'user';
          contents.push({
            role,
            parts: [{text: String(turn.content).slice(0, 2000)}],
          });
        });
        contents.push({role: 'user', parts: [{text: message}]});

        const genAI = new GoogleGenAI({apiKey});
        const result = await genAI.models.generateContent({
          model: 'gemini-2.0-flash',
          contents,
        });
        const text = String(result.text || '').trim();
        if (!text) {
          res.status(502).json({error: 'Empty model response'});
          return;
        }

        let reply = text;
        let actions = [];
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && typeof parsed.reply === 'string') reply = parsed.reply;
            if (parsed && Array.isArray(parsed.actions)) {
              actions = parsed.actions.slice(0, 5).filter((a) => a && typeof a === 'object' && a.type);
            }
          } catch (parseErr) {
            // keep plain text reply
          }
        }

        res.json({
          reply,
          actions,
          model: 'gemini-2.0-flash',
          source: 'gemini',
        });
      } catch (err) {
        console.error('coachChat', err);
        const code = err.code === 'auth/id-token-expired' ? 401 : 500;
        res.status(code).json({error: err.message || 'Internal error'});
      }
    },
);

/**
 * After each market listing status change (list / invest / cancel / sold),
 * verify NFT custody on Devnet and write `txHealth` on the doc.
 */
exports.onMarketListingHealth = onDocumentWritten(
    {
      document: 'marketListings/{listingId}',
      region: REGION,
      timeoutSeconds: 60,
      memory: '256MiB',
      maxInstances: 4,
    },
    async (event) => {
      const before = event.data && event.data.before && event.data.before.exists
        ? event.data.before.data()
        : null;
      const after = event.data && event.data.after && event.data.after.exists
        ? event.data.after.data()
        : null;
      if (!after) return;
      const ref = event.data.after.ref;
      try {
        setPreferredRpc(process.env.SOLANA_RPC_URL || '');
        await onMarketListingChange(before, after, ref);
      } catch (err) {
        console.error('onMarketListingHealth', event.params.listingId, err);
      }
    },
);

/** After seed mint status → minted/failed. */
exports.onSeedMintHealth = onDocumentWritten(
    {
      document: 'seedMints/{requestId}',
      region: REGION,
      timeoutSeconds: 60,
      memory: '256MiB',
      maxInstances: 4,
    },
    async (event) => {
      const before = event.data && event.data.before && event.data.before.exists
        ? event.data.before.data()
        : null;
      const after = event.data && event.data.after && event.data.after.exists
        ? event.data.after.data()
        : null;
      if (!after) return;
      try {
        setPreferredRpc(process.env.SOLANA_RPC_URL || '');
        await onMintDocChange(before, after, event.data.after.ref, 'seedMints');
      } catch (err) {
        console.error('onSeedMintHealth', event.params.requestId, err);
      }
    },
);

/** After growth mint status → minted/failed. */
exports.onGrowthMintHealth = onDocumentWritten(
    {
      document: 'growthMints/{requestId}',
      region: REGION,
      timeoutSeconds: 60,
      memory: '256MiB',
      maxInstances: 4,
    },
    async (event) => {
      const before = event.data && event.data.before && event.data.before.exists
        ? event.data.before.data()
        : null;
      const after = event.data && event.data.after && event.data.after.exists
        ? event.data.after.data()
        : null;
      if (!after) return;
      try {
        setPreferredRpc(process.env.SOLANA_RPC_URL || '');
        await onMintDocChange(before, after, event.data.after.ref, 'growthMints');
      } catch (err) {
        console.error('onGrowthMintHealth', event.params.requestId, err);
      }
    },
);

/**
 * Manual / CI: verify one listing or mint by id.
 * POST { collection: 'marketListings'|'seedMints'|'growthMints', id: '...' }
 */
exports.verifyTxHealth = onRequest(
    {
      region: REGION,
      cors: true,
      invoker: 'public',
      timeoutSeconds: 60,
      memory: '256MiB',
      maxInstances: 2,
    },
    async (req, res) => {
      if (!allowReconcileRequest(req)) {
        res.status(429).json({ok: false, error: 'Too many requests'});
        return;
      }
      try {
        setPreferredRpc(process.env.SOLANA_RPC_URL || '');
        const body = req.method === 'GET' ? req.query : req.body || {};
        const collection = String(body.collection || '');
        const id = String(body.id || '');
        const allowed = ['marketListings', 'seedMints', 'growthMints'];
        if (!allowed.includes(collection) || !id) {
          res.status(400).json({
            ok: false,
            error: 'Provide collection (marketListings|seedMints|growthMints) and id',
          });
          return;
        }
        const ref = getFirestore().collection(collection).doc(id);
        const snap = await ref.get();
        if (!snap.exists) {
          res.status(404).json({ok: false, error: 'Document not found'});
          return;
        }
        const data = snap.data() || {};
        const result =
          collection === 'marketListings'
            ? await verifyListingCustody(data)
            : await verifyMintDoc(data);
        await persistHealth(ref, result, 'verifyTxHealth');
        res.json({ok: result.ok, ...result});
      } catch (err) {
        console.error('verifyTxHealth', err);
        res.status(500).json({ok: false, error: (err && err.message) || 'verify failed'});
      }
    },
);
