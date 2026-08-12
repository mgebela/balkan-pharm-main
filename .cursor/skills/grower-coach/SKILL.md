---
name: grower-coach
description: >-
  Guides edits to growtoo's Grower/Adopter Coach (Gemini coachChat, journal
  snapshot, proposed app actions). Use when working on Coach, Grower Coach,
  Adopter Coach, coachChat, ai-coach.js, coach-system.js, coach-knowledge.js,
  coach-context.js, Gemini coach, journal snapshot, coach actions, cultivation
  knowledge, or coach quota/auth.
---

# Growtoo Grower Coach

The live Coach is **Gemini `gemini-2.0-flash`** via Cloud Function `coachChat`. Cursor is for editing that system — never the grower-facing model.

Do **not** wire Cursor SDK, cloud agents, or this chat as the Coach backend.

## Before changing behavior

Read the source of truth (do not copy the full system prompt into new files):

1. `functions/coach-system.js` — voice, JSON contract, allowed actions
2. `functions/coach-knowledge.js` — BM25 retrieval + Croatian→English query bridge
3. `functions/coach-context.js` — snapshot trim (never `JSON.stringify().slice`)
4. `app/js/ai-coach.js` — client snapshot, local intent fallback, `executeAction`
5. `functions/index.js` — `exports.coachChat`, `COACH_RESPONSE_SCHEMA`

Action payloads, snapshot fields, and knowledge files: [reference.md](reference.md)

## Pipeline

1. Verify Firebase ID token + App Check; enforce daily quota (`GEMINI_API_KEY`).
2. Optional plant photo: `data:image/(jpeg|png|webp);base64,...` (size-capped).
3. `getRelevantKnowledge(userText, stageKey)` — max 3 sections from `functions/knowledge/*.md`.
4. `buildContextJson(context)` — priority fields first; trim `tokens`, `recentEntries`, `plants`.
5. `buildCoachSystem(context)` — grower vs adopter + skill adaptation 1–5.
6. Reply **JSON only**: `{ reply, actions }`. Adopters: force `actions` to `[]`.

Client URL: `https://coachchat-zwul5y4amq-ew.a.run.app` in `app/js/ai-coach.js`.

## Voice and rules

- Grower: practical CBD/hemp + tokenisation peer. Propose app actions; ground in snapshot numbers; never invent readings, dates, or symptoms.
- Photo: describe what is visible first, then hypotheses. At most one clarifying question.
- Adopter: explain care progress / live stage / unlock months. No journal or mint mutations. Honest about Devnet.
- Match user language (English default; Croatian if they write Croatian).
- Max 5 actions. No deletes.
- Stages (Croatian keys): `klijanje` germination, `sadnica` seedling, `vegetativna` vegetative, `cvjetanje` flowering, `susenje` drying/harvest.

## Where to put changes

| Change | Where |
| --- | --- |
| Voice, action types, grower vs adopter rules | `functions/coach-system.js` |
| Cultivation facts | `functions/knowledge/*.md` **and** HR terms in `coach-knowledge.js` — not only the system prompt |
| Snapshot shape / trim | `functions/coach-context.js` + client builder in `ai-coach.js` |
| Confirm/execute proposed actions | `app/js/ai-coach.js` (`executeAction`) |
| JSON schema / quota / auth | `functions/index.js` |

Keep `{ reply, actions }` and adopter `actions: []`. Do not stringify-slice context.

## Tests

From `functions/`:

```bash
npm test
```

Runs `coach-context.test.js` and `coach-knowledge.test.js` (plus `user-guards.test.js`). Add coverage when changing trim order, HR bridge, or knowledge matching.
