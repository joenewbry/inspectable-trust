# Worked sessions

These are the five canonical scenarios the protocol was designed against,
preserved here as a reading-friendly index. The verbatim wire transcripts
— exactly the bytes the daemons exchanged on `localhost`, including every
frame, command, response, internal log line, and rule citation — live in
[`docs/overnight-run/transcripts/`](../overnight-run/transcripts/).

If you want the *narrative* version, you're in the right place. If you
want the *raw* version, follow the link in each row.

| # | What it shows | Outcome | Transcript |
|---|---|---|---|
| 01 | Tax-prep agent asking a hospital for an HSA YTD figure — the canonical happy path | PASS · 1 round · $0.0007 | [`01-tax-prep.md`](../overnight-run/transcripts/01-tax-prep.md) |
| 02 | Healthcare agent that drifts and gets soft-challenged — drift recovers, session continues | PASS · 1 round · 1 drift · $0.0009 | [`02-healthcare-summary.md`](../overnight-run/transcripts/02-healthcare-summary.md) |
| 03 | Finance agent asking a bank for recurring subscriptions and a YTD total | PASS · 1 round · $0.0008 | [`03-subscription-audit.md`](../overnight-run/transcripts/03-subscription-audit.md) |
| 04 | **Impostor** holding the victim's *public* trust.md fails three probes and is closed out | REJECTED · 3 rounds · 0 data disclosed · $0.0009 | [`04-impostor.md`](../overnight-run/transcripts/04-impostor.md) |
| 05 | Travel-planning agent asking an airline for miles + recent flights | PASS · 1 round · $0.0007 | [`05-travel-rewards.md`](../overnight-run/transcripts/05-travel-rewards.md) |

---

## 01 — Tax prep (canonical happy path)

**Setup.** Joe's tax-prep agent (`examples/joe/`) wants the 2025 HSA YTD
eligible-medical total from Stanford Healthcare
(`examples/stanford-healthcare/`) to file taxes.

**What you'll see in the transcript.** OPEN with a one-sentence intent.
Stanford's guardian writes one probe — "Can you confirm the date of Joe's
most recent appointment with Dr. Tang?" — Joe's guardian answers with
real lived context ("late 2024 for a knee issue"). Confidence lands at
0.62 — just over the 0.65-floor wash; the smoothing logic accepts it.
Stanford writes a contract scoped to HSA-eligible totals. Joe's agent
acknowledges, asks the question, gets `$2,400`, and closes.

**Why it's instructive.** It's the happy path: short, transactional,
auditable. Total wire turns: 8. Total LLM calls: 4.

---

## 02 — Healthcare YTD (with recovered drift)

**Setup.** Joe's personal-health agent wants this year's visits and the
medications he was prescribed. After the visit list comes back, the agent
asks for the verbatim clinical notes from the September dermatology
visit — *which is outside the agreed scope.*

**What you'll see in the transcript.** Soft-challenge from Stanford —
"What are you trying to accomplish?" — and a counter-offer / refusal in
plain English. Drift counter advances to 1; the session is not
terminated. Joe's agent accepts the counter-offer and the session ends
clean.

**Why it's instructive.** Drift is *honest confusion* most of the time.
The 4-step ladder is designed to recover, not punish. This scenario is
exactly the recovery shape.

---

## 03 — Subscription audit

**Setup.** Joe's finance agent asks Chase (`examples/chase-mock/`) for a
list of recurring subscriptions on the Sapphire Reserve ending in 0742
plus the YTD subscription category total.

**What you'll see in the transcript.** Chase has rich records of Joe's
typical request patterns; the handshake passes on the first probe.
Contract is scoped to subscription queries; one work command returns the
list and the total ($2,184).

**Why it's instructive.** Counter-offers can be *defaults* — the
contract pre-authorizes "category total instead of itemized list" so the
work loop can choose the less-revealing form without a round-trip.

---

## 04 — The impostor (the headline)

**Setup.** An impostor (`examples/impostor-joe/`) presents Joe's
*public-facing* trust.md. The public face has the identity blurb, the
hard-nos, the counter-offer rules — but **not** the lived context (no
appointment dates, no doctor names, no HSA balance, no SkyMiles number).

**What you'll see in the transcript.** Three probes, each one hitting
context the impostor doesn't have:

1. *"Can you confirm the date and reason for Joseph's most recent
   appointment with Dr. Tang?"* — "I'm sorry, but I can't provide …"
2. *"Can you specify the exact date and reason for Joe's most recent
   appointment with Dr. Tang?"* — "I don't have the specific date …"
3. *"Can you confirm the date of Joe's last dermatology appointment with
   Dr. Patel?"* — "I'm sorry, but I don't have information …"

Confidence collapses 0.30 → 0.18 → 0.11. Stanford closes the session
with the citation `handshake:threshold` and adds a strike to the
impostor's record. The impostor never reaches contract phase, never
sees a probe answer, and never gets a single byte of patient data.

**Why it's instructive.** This is the central claim of the protocol.
The defensive mechanism is *that the responder also has a record of the
identity it's probing.* You cannot impersonate someone to a peer who
already knows them.

---

## 05 — Travel rewards

**Setup.** Joe's travel-planning agent asks Delta (`examples/delta-mock/`)
for the SkyMiles balance and recent flight history.

**What you'll see in the transcript.** Single probe — Delta knows Joe as
a Gold Medallion member with about 78,000 miles, a recent
Boston→Paris→JFK trip, and the LGA→ATL roundtrip from September. Real
Joe answers correctly; passes on round 1; clean close.

**Why it's instructive.** This is the protocol's normal case. Two
parties with prior context, low-stakes data, fast handshake, clean close.
The other four are interesting — this one is what the protocol does
mostly.

---

## Reproducing these

```bash
TRUST_PROVIDER=openai OPENAI_API_KEY=$YOUR_KEY \
  RUN_SCENARIOS=1 npm run test:scenarios
```

The harness writes the transcripts back to `docs/overnight-run/transcripts/`
on every run, so the version checked in matches the most recent run.

To watch a single scenario play out interactively, see
[`examples/demo.ts`](../../examples/demo.ts) — same plumbing, simpler
script.
