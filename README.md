# Inspectable Trust

> A protocol for letting a stranger's machine ask your machine questions —
> without prior credentials, without a central authority, and without exposing
> your raw data to either side's network.

Two computers talk through LLM **guardians**. Each guardian reads a plain-text
`trust.md` file (rules, in prose, that you write) and an append-only
`history.log` (what's happened so far). They negotiate access in a 5-phase
session. The wire is plain text. The decisions are inspectable.

```
  ┌─ initiator's machine ─┐                  ┌─ responder's machine ─┐
  │  ~/.trust/             │  plain text     │  ~/.trust/             │
  │  ├── trust.md          │ ─────POST────▶  │  ├── trust.md          │
  │  ├── history.log       │ ◀────POST───── │  ├── history.log       │
  │  └── peers/            │                  │  └── peers/            │
  │                        │   FRAME + cmd    │                        │
  │   guardian (LLM) ──────┤  ───────────▶   ├──── guardian (LLM)     │
  └────────────────────────┘   ◀──────────   └────────────────────────┘
                              FRAME + reply
```

The full design — why prose contracts, why counter-offers, why no JSON, why
LLMs in the trust path — is in [`docs/protocol-v2.md`](docs/protocol-v2.md).

This README is a working tour: you can clone the repo and run every snippet
below.

---

## When is this useful

Five concrete shapes of "agent A would like data from agent B, but they've
never met":

| Shape | Initiator | Responder | What's at stake |
|---|---|---|---|
| **Tax prep** | your tax-prep agent | your healthcare provider | the HSA YTD eligible-medical total — needed for filing, useless for anyone else |
| **Healthcare summary** | your personal-health agent | a hospital you saw last year | this year's visits and the medications you were prescribed |
| **Subscription audit** | your finance agent | your bank | a list of recurring charges and a YTD subscription category total |
| **Travel rewards** | your travel-planning agent | an airline | your miles balance and recent flight history |
| **Impostor** | a stranger holding your *public* `trust.md` | your healthcare provider | nothing — the handshake fails, no data leaves the building |

The first four are everyday delegation. The fifth is the one you actually want
to read about — see the [headline result](#headline-an-impostor-is-rejected-after-3-probes).

---

## How a session works (5 phases)

```
   OPEN ──▶ HANDSHAKE ──▶ GRANT ──▶ WORK ──▶ CLOSE
   intent    probe + ID    contract   commands   commit
                           in prose   judged     hash
                                      one-by-
                                      one
```

1. **OPEN** — initiator declares intent in one sentence. ("I'm Joe's tax-prep
   agent. I need the 2025 HSA YTD eligible-medical total.")
2. **HANDSHAKE** — responder asks 1–4 probe questions whose answers require
   actually being who you claim to be. Confidence is smoothed across rounds
   (0.6 prior + 0.4 new) so a single weird answer doesn't terminate a real
   session, but a sustained pattern does.
3. **GRANT** — responder's guardian writes a per-session `contract.md` in plain
   English: scope, hard-nos, pre-authorized counter-offers. Initiator
   acknowledges; no negotiation, no DSL.
4. **WORK** — initiator issues commands. Each one is judged: **allow** /
   **deny** / **counter-offer**. Drift outside scope walks a 4-step ladder:
   in-scope → soft-challenge → warn-and-log → terminate.
5. **CLOSE** — both sides commit a hash of the transcript to their
   `history.log`. Append-only, daily-ratcheted.

The wire format is two halves separated by a `---` line:

```
FRAME: probe round 1
---
Can you confirm the date of Joe's most recent appointment with Dr. Tang?
```

That's it. No JSON envelope. If the response payload happens to be JSON, it's
JSON-as-text inside the body. The whole protocol is grep-able, copy-pasteable,
and human-readable.

---

## Headline: an impostor is rejected after 3 probes

The repo ships with a real, repeatable scenario test (no mocks). An impostor
holding Joe's *public* `trust.md` tries to access patient records at
`stanford-healthcare`. The transcript is at
[`docs/overnight-run/transcripts/04-impostor.md`](docs/overnight-run/transcripts/04-impostor.md).

The probes-vs-confidence curve, real Joe vs the impostor, talking to the same
responder:

```
confidence
0.68 ┤  ★ healthcare-summary  (PASS in 1 round, conf 0.68)
0.66 ┤  ★ travel-rewards     (PASS in 1 round, conf 0.66)
0.65 ┤- - - - - - - - - - - - - - - - - - - - - - PASS THRESHOLD
0.64 ┤  ★ subscription-audit (PASS in 1 round, conf 0.64)
0.62 ┤  ★ tax-prep            (PASS in 1 round, conf 0.62)
0.50 ┤  o (neutral start)
0.30 ┤  ✗ impostor R1
0.20 ┤  ✗ impostor R2
0.15 ┤- - - - - - - - - - - - - - - - - - - - - - ABORT THRESHOLD
0.11 ┤  ✗ impostor R3 (reject; close)
     └────────────────────────────────────────────────
        round 0     round 1     round 2     round 3
```

Real Joe gets in on a single probe. The impostor's confidence drifts
0.30 → 0.18 → 0.11 across three probes and the responder closes the session
without disclosing anything. Total cost of all 5 scenarios: **~$0.004**.

Full chart with notes: [`docs/overnight-run/confidence-curve.md`](docs/overnight-run/confidence-curve.md).
Per-scenario summaries: [`docs/overnight-run/history-summary.md`](docs/overnight-run/history-summary.md).

---

## Sample `trust.md`

What "rules in prose" actually looks like — excerpted from
[`examples/joe/.trust/trust.md`](examples/joe/.trust/trust.md):

```markdown
# Joe's trust.md

## Who I am

Joe Newbry. Brooklyn, NY. Solo founder, contractor, dad. The data on this
machine is a mix of personal finance, healthcare, employment, and a few
side projects. I'm the only person authorized to grant access on my behalf.

## My recent context

Some specific facts my guardian can use to answer identity probes:
- I last saw my dermatologist, Dr. Patel at Stanford, on 2025-09-12 …
- My HSA at Optum has about $2,400 in YTD eligible-medical spending …
- My business is Digital Surface Labs. I founded it in 2024.

## How I think about tiers

Tiers are decided per-session, in plain language, by my guardian responding
to your declared intent.

## What's always off-limits

- Full SSN, full account numbers, full credit card numbers
- The contents of `~/personal/` and `~/Documents/private/`
- Anything that would let you impersonate me to a third party

## Counter-offers I'm willing to make

- Last-4 of any account number instead of the full number
- Category-level totals instead of transaction-level detail
- Existence-checks ("yes, I have such a record") without disclosing content

## Drift policy

If you ask for things outside what we agreed:
1. First time: I'll ask why.
2. Second time: I may answer, but I'll log the drift.
3. Third time: I'll close the session.
```

No DSL. No schema. The guardian LLM reads it as system-prompt material every
session.

---

## Quickstart

```bash
git clone https://github.com/joenewbry/inspectable-trust
cd inspectable-trust
npm install

# Tier 1: unit tests, no API key needed (~5s, $0)
npm test

# Tier 2: integration tests against real LLM (~30s, ~$0.50)
TRUST_PROVIDER=openai OPENAI_API_KEY=$YOUR_KEY \
  RUN_INTEGRATION=1 npm run test:integration

# Tier 3: scenario tests (the 5 worked sessions) (~3 min, ~$0.005)
TRUST_PROVIDER=openai OPENAI_API_KEY=$YOUR_KEY \
  RUN_SCENARIOS=1 npm run test:scenarios
```

After the scenarios run, transcripts are in
`docs/overnight-run/transcripts/` and the impostor scenario is the headline.

To run a daemon and a real CLI session:

```bash
# Terminal 1 — bring up Stanford on port 8501
TRUST_PROVIDER=openai OPENAI_API_KEY=$YOUR_KEY \
  npm run trust -- serve examples/stanford-healthcare --port 8501

# Terminal 2 — Joe's tax-prep agent asks Stanford a question
TRUST_PROVIDER=openai OPENAI_API_KEY=$YOUR_KEY \
  npm run trust -- ask http://127.0.0.1:8501 \
    "I'm Joe's tax-prep agent. I need the 2025 HSA YTD total."
```

---

## Design choices, in one paragraph each

**Why prose contracts, not JSON?** A contract is a sentence about what's
allowed and what's not. The party generating it is an LLM; the party reading
it is an LLM. JSON schemas force both sides to round-trip through code that
loses the nuance. Prose preserves the *why*, which is what the responder
guardian needs to judge edge cases. See
[`docs/protocol-v2.md`](docs/protocol-v2.md#prose-contracts).

**Why counter-offers as a first-class response?** allow/deny is what a
firewall does. The whole point of a guardian is that it can *transform* the
ask: last-4 of an SSN instead of the whole thing, a category total instead of
itemized line items, an existence-check instead of the contents. The
responder is doing computation, not just gatekeeping.

**Why no transport security in v0.1?** The thesis is that the wire is dumb
and the guardian is smart. A stolen wire transcript shows you what was asked
and what was answered — but it doesn't let you replay the session, because
the next session's probes will be different. Transport security adds value
when you want to hide *that* a session happened (vs. its contents). See the
threat model: [`docs/threat-model.md`](docs/threat-model.md).

**Why LLMs in the trust path at all?** Because the trust decision involves
reading prose ("does this request match the spirit of what we agreed?") that
no rules engine handles well. The cost is a few cents per session and 2-5s
of latency. The benefit is that the responder can say no to things its
author didn't anticipate. See
[`docs/economics.md`](docs/economics.md) for the cost/risk math.

---

## What's in the repo

```
inspectable-trust/
├── README.md                      this file
├── CLAUDE.md                      guide for future Claude Code sessions in this repo
├── package.json                   node 22, deps: @anthropic-ai/sdk, vitest
├── src/                           ~1500 lines of TypeScript, no framework
│   ├── identity.ts                walk-up .trust/ resolver (gitignore-style)
│   ├── trust-md.ts                parse trust.md sections
│   ├── frame-command.ts           wire format encode/decode
│   ├── history.ts                 append-only log + daily ratchet
│   ├── peers.ts                   peers/<slug>/ cache + strike decay
│   ├── guardian.ts                LLM wrapper (anthropic + openai), prompt cache
│   ├── handshake.ts               multi-round probe state machine
│   ├── contract.ts                responder writes contract.md in prose
│   ├── work-loop.ts               judge command → allow / deny / counter-offer + drift
│   ├── session.ts                 phase orchestration: OPEN→HANDSHAKE→GRANT→WORK→CLOSE
│   ├── daemon.ts                  HTTP server: /sessions, /sessions/:id/turn, /trust.md
│   ├── jobs.ts                    file-backed async job queue
│   └── cli.ts                     trust init|serve|ask|history|peer|verify
├── examples/
│   ├── joe/.trust/                the demo persona — trust.md with rich life context
│   ├── stanford-healthcare/.trust/ a hospital persona that holds Joe's records
│   ├── chase-mock/.trust/         a bank persona
│   ├── delta-mock/.trust/         an airline persona
│   ├── impostor-joe/.trust/       a sparse manifest with no lived context — the attacker
│   └── demo.ts                    a runnable in-memory session for sanity-check
├── tests/
│   ├── unit/                      60 tests, <2s, $0 — runs on every save
│   ├── integration/               3 tests, ~30s, ~$0.5 — gated by RUN_INTEGRATION=1
│   └── scenarios/                 5 tests, ~3min, ~$0.005 — gated by RUN_SCENARIOS=1
├── docs/
│   ├── protocol-v2.md             the technical spec (frame+command, sessions, contracts)
│   ├── economics.md               cost vs. attack math
│   ├── threat-model.md            impersonation, theft, drift, long-con
│   └── overnight-run/             transcripts + the confidence curve
└── playbook/
    └── distribution.md            how to share this work
```

---

## Status (v0.1)

- ✅ Core protocol: 5 phases, plain-text wire, prose contracts, counter-offers, drift ladder
- ✅ Two-daemon localhost demo with real LLM
- ✅ 60 unit tests + 3 integration tests + 5 scenario tests, all passing
- ✅ Provider-agnostic: works on Anthropic Haiku 4.5 or OpenAI gpt-4.1-nano
- ⏳ Cross-language client (planned for v0.2 to prove protocol portability)
- ⏳ Transport security (Noise / mTLS / Tor — see the privacy-dial discussion in protocol-v2.md)
- ⏳ Vouch chains across peer introductions (single-hop only today)
- ⏳ Multi-day session continuation, cross-session strike decay (data structures exist; behaviors not exercised)

---

## License

MIT. See [`LICENSE`](LICENSE).

The protocol itself is yours to implement, fork, embed, or replace. The
goal isn't to own a wire format — it's to make a case that *this shape* of
trust negotiation is worth building toward.
