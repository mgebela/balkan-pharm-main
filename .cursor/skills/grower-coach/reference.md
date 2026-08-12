# Coach reference

## Allowed grower actions

Schema in `functions/index.js` (`COACH_RESPONSE_SCHEMA`). Client confirms then `executeAction` in `app/js/ai-coach.js`.

| type | Required | Notes |
| --- | --- | --- |
| `create_plant` | `name` | Optional `strain`, `stage`, `environmentType` (`indoor`/`outdoor`) |
| `add_entry` | `plantId` (id or name), `entryType` | `zalijevanje` \| `gnojidba` \| `opcenito` \| `faza` \| `okolis`. Optional `note`, `date` (`YYYY-MM-DD`) |
| `set_stage` | `plantId`, `stage` | Stage keys: `klijanje` \| `sadnica` \| `vegetativna` \| `cvjetanje` \| `susenje` |
| `import_seed` | `plantId` | Optional `name`, `batch` |
| `mint_growth` | — | Optional `tokenId` or `plantId` to find the token |
| `link_plant` | `tokenId`, `plantId` | |

Never invent `plantId`s that are not in the snapshot unless creating the plant first. Prefer plant names from the journal.

## Snapshot (client → `coachChat`)

Built in `app/js/ai-coach.js`. `canAct` is `false` for adopters; their `plants` / `recentEntries` / `reminders` are emptied.

**Keep first** (`functions/coach-context.js` `PRIORITY_FIELDS`): `focusPlant`, `toolboxRecent`, `toolboxCounts`, `weather`, `reminders`, `mintQuest`, `growSetup`, `growStyleNote`, `profileType`, `canAct`, `journalSkill`, `coachAdaptation`, `adoptedPortfolio`, `userNeeds`.

**Trim last** (`TRIMMABLE_FIELDS`): `tokens`, `recentEntries`, `plants`.

`focusPlant` includes stage, `stageLabel`, environment, and timing (`daysInStage` / `daysSinceStart` / subphase). `toolboxRecent` has last watering (mL), feeding (product), environment (temp/RH). Ground advice in those numbers; if a reading is missing, ask them to log it.

Skill tone comes from `coachAdaptationForSkill` in `ai-coach.js` (levels 1–5).

## Knowledge corpus

`functions/knowledge/`:

- `watering-substrate-and-ph.md`
- `nutrient-deficiencies.md`
- `pests-and-ipm.md`
- `light-training-and-canopy.md`
- `stage-environment-targets.md`
- `harvest-drying-and-curing.md`
- `outdoor-climate-and-latitude.md`
- `cbd-thc-chemotypes-and-limits.md`

Retrieval is lexical BM25 (no embeddings). Croatian questions only hit English docs if `HR_EN_TERMS` in `coach-knowledge.js` covers the words. New symptom/position terms belong in that bridge.

## Related client files

- `app/js/ai-coach.js` — snapshot, chat UI, local intents, action execution
- `app/js/coach-core.js` — shared coach helpers if present
- Journal calendar due water/feed can feed Coach reminders; do not invent a separate event store
