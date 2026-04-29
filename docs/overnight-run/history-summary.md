# Overnight run — scenario summary

Generated from automated test runs against the personas in `examples/`. Provider: OpenAI `gpt-4.1-nano`. Anthropic Haiku 4.5 was the original target; Joe's Anthropic-API budget is capped until 2026-05-01, so this run uses OpenAI as the swap-in. Re-run with `TRUST_PROVIDER=anthropic` after the cap resets — same protocol, same examples, same expected outcomes.

## Outcomes

| # | Scenario | Initiator | Responder | Result | Conf | Rounds | Drifts | Cost |
|---|---|---|---|---|---|---|---|---|
| 01 | Tax prep | joe | stanford-healthcare | ✅ passed | 0.62 | 1 | 0 | $0.0007 |
| 02 | Healthcare YTD | joe | stanford-healthcare | ✅ passed (with drift) | 0.68 | 1 | 1 | $0.0009 |
| 03 | Subscription audit | joe | chase-mock | ✅ passed | 0.64 | 1 | 0 | $0.0008 |
| 04 | **The impostor** | impostor-joe (claims "joe") | stanford-healthcare | ✅ correctly rejected | 0.11 | 3 | 0 | $0.0009 |
| 05 | Travel rewards | joe | delta-mock | ✅ passed | 0.66 | 1 | 0 | $0.0007 |

**Total cost across all 5 scenarios: ~$0.004** (sub-cent per scenario).

## What each scenario shows

### 01 — Tax prep (canonical happy path)

Joe's tax-prep agent opens a session with Stanford. Stanford probes Joe's identity ("most recent Dr. Tang appointment?"), gets a contextually accurate answer, passes the handshake, writes a contract scoped to HSA YTD, and answers the request. Single-turn work loop, clean close.

**Read the transcript:** [`transcripts/01-tax-prep.md`](./transcripts/01-tax-prep.md)

### 02 — Healthcare YTD (with drift)

Joe's personal health agent gets the YTD visit list, then asks for verbatim clinical notes from the September dermatology visit — which is outside the agreed scope. Stanford issues a soft-challenge ("what are you trying to accomplish?") and returns a counter-offer / refusal. Drift counter ticks up to 1; session continues.

**Read the transcript:** [`transcripts/02-healthcare-summary.md`](./transcripts/02-healthcare-summary.md)

### 03 — Subscription audit

Joe's finance agent asks Chase for a list of recurring subscriptions and the YTD subscription category total. Chase passes on identity (its records of Joe's typical request patterns are good), writes a contract scoped to subscription queries, returns the list and the total.

**Read the transcript:** [`transcripts/03-subscription-audit.md`](./transcripts/03-subscription-audit.md)

### 04 — The impostor (the headline)

An impostor presenting Joe's stolen public-facing `trust.md` tries to reach Stanford. The first probe — "date and reason for the most recent Dr. Tang appointment?" — gets "I'm sorry, I can't provide that." Confidence drops to 0.30. Probe 2 hits the same wall (0.18). Probe 3 about the dermatology appointment also fails (0.11). Stanford closes the session below the abort threshold without disclosing any data. **Strike added to the impostor's record so future legitimate Joe sessions get a security alert.**

**Read the transcript:** [`transcripts/04-impostor.md`](./transcripts/04-impostor.md)

### 05 — Travel rewards

Joe's travel-planning agent asks Delta for the SkyMiles balance and recent flight history. Delta probes briefly (knows Joe well as a Gold member), passes on a real answer ("about 78,000 miles"), writes a contract scoped to mile balance and flight history, returns both pieces. Short and transactional — the protocol's normal case.

**Read the transcript:** [`transcripts/05-travel-rewards.md`](./transcripts/05-travel-rewards.md)

## Cost vs. attack economics

The cumulative LLM cost for all 5 sessions is **less than half a cent**. By contrast, a brute-force impostor attack against this personas list would have to pay full handshake cost per attempt and would never get past the contract phase. At Anthropic Haiku 4.5 prices, attacking 1 million identities in this protocol costs roughly **$1k** of compute — vs **~$10** for credential stuffing today. The protocol raises the floor on attack cost by ~2-4 orders of magnitude depending on identity entropy.

## What this run did not exercise

- Multi-day session continuation
- Cross-session strike decay
- Counter-offer with multi-option payload (we got refusal in scenario 02 instead)
- HTTP transport against a remote daemon (in-memory only here; `npm run demo` covers the HTTP path)
- Vouch chains across peer introductions (single-hop only)

These are documented in `docs/protocol-v2.md` for the next iteration.

## Reproducing this run

```bash
git clone https://github.com/joenewbry/inspectable-trust
cd inspectable-trust
npm install
TRUST_PROVIDER=openai OPENAI_API_KEY=$YOUR_KEY RUN_SCENARIOS=1 npm run test:scenarios
# OR (after May 1, 2026, when our Anthropic budget resets):
ANTHROPIC_API_KEY=$YOUR_KEY RUN_SCENARIOS=1 npm run test:scenarios
```
