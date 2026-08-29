# Approved public claims

Use only these claims in drafts unless the human adds a new row. Record **source** and **date** for every fact. If a claim is missing here, mark the draft `needs-approval` and do not invent it.

Do not publish pitch-deck numbers, mint counts, fundraising asks, tester names, partnership names, or mainnet dates from other repo files.

## Product

| Claim | Source | Date recorded |
| --- | --- | --- |
| growtoo is a free grow journal for cannabis growers. | User community brief; `index.html` landing meta; `locales/en/landing.json` growers.body2 | 2026-08-29 |
| Features include a journal, reminders, weather planning, an AI coach, photos, and growth-stage tracking. | User community brief; `locales/en/landing.json` growers.body1 | 2026-08-29 |
| Optional Solana-based proof / on-chain plant history exists for people who want it. | User community brief; `index.html` meta description | 2026-08-29 |
| The journal, coach, and reminders work with no wallet. A Solana wallet is only needed to mint or adopt on the test network. | `locales/en/landing.json` faq.a1; `locales/en/terms.json` p3 | 2026-08-29 |
| Public site: https://growto.live/ | `README.md`; `index.html` canonical | 2026-08-29 |
| growtoo is a documentation tool, not legal advice. Growers should follow the law where they grow. | `locales/en/landing.json` faq.a2 | 2026-08-29 |
| Users must be at least 18 and legally allowed to use grow-related information services where they live. | `locales/en/terms.json` p2 | 2026-08-29 |

## Status (honest early-stage)

| Claim | Source | Date recorded |
| --- | --- | --- |
| growtoo is early and being tested by a small number of growers. | User community brief | 2026-08-29 |
| Optional chain features run on Solana Devnet (public test network), not mainnet. | `risks/index.html`; `locales/en/landing.json` faq.a5 | 2026-08-29 |
| Devnet tokens and test $GROWTOO have no monetary value. | `risks/index.html`; `locales/en/landing.json` faq.a6; `locales/en/terms.json` p3 | 2026-08-29 |
| On-chain records on Devnet are process evidence from the journal trail, not proof a physical plant exists. | `locales/en/landing.json` faq.a3 | 2026-08-29 |
| Harvest / physical redemption is specified but not a live fulfillment pipeline on Devnet. | `locales/en/landing.json` faq.a4 | 2026-08-29 |

## Allowed phrasing

- “growtoo is a free grow journal — reminders, weather, an AI coach, photos, stages. Optional on-chain proof if you want it.”
- “It’s early. We’re on Solana Devnet, testing with a small group of growers.”
- “The journal works without a wallet. Devnet tokens have no monetary value.”
- “An AI coach can read the log and prompt the next check. It should not replace looking at the plant.”

## Do not claim

- User counts, download counts, retention, revenue, or “growers love us”
- That cannabis is legal in a place unless the human supplies a sourced local-law note
- That $GROWTOO, staking, or harvest redemption has financial value or is live on mainnet
- Partnerships, investors, Superteam outcomes, or fundraising status
- That the coach diagnoses disease, replaces a grower, or gives medical advice
- That on-chain proof verifies a real plant today
- Personal growing experience

## Adding a claim

1. Write the fact in `community/claims-pending.md` with source URL or file path and date.
2. Ask the human to approve it.
3. After approval, add a row here. Do not use it in drafts before that.
