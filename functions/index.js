const {onRequest} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const {initializeApp} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {GoogleGenAI} = require('@google/genai');

initializeApp();

// Set after: firebase functions:secrets:set GEMINI_API_KEY
const geminiApiKey = defineSecret('GEMINI_API_KEY');

const REGION = 'europe-west1';

/**
 * Health check — verify deploy works before wiring Gemini.
 * GET https://<region>-<project>.cloudfunctions.net/healthCheck
 */
exports.healthCheck = onRequest({region: REGION}, (req, res) => {
  res.json({ok: true, service: 'dnevnik-live-functions'});
});

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
