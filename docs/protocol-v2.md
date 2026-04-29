# Inspectable Trust — Protocol v2

> Status: implemented in this repo. Subject to change as v0.2 lands transport
> security and a second-language client.

This document specifies the protocol that `src/` implements. It is the
*technical* companion to the conceptual essay
[`docs/protocol-v1.md`](protocol-v1.md) (the "why") and the threat model
([`threat-model.md`](threat-model.md)) and economics analysis
([`economics.md`](economics.md)).

If you are picking this up cold, read the [README](../README.md) first; it
contains the worked example and the headline impostor result.

---

## Goals (and explicit non-goals)

**Goals**

1. A stranger's machine can ask my machine for data without us having
   exchanged credentials beforehand.
2. The trust decision is made by *my* guardian, not a central authority.
3. The full transcript of any session is human-readable and grep-able.
4. The cost of a single session is in the cents, and the cost of attacking
   the protocol at scale is orders of magnitude higher than today's
   credential-stuffing baseline.
5. The protocol is implementable in ~1500 lines of any language with an LLM
   client and a file system.

**Non-goals (deliberate)**

- *Replacing OAuth.* For consumer↔provider flows where there's an existing
  trust anchor (your bank, your Google account), OAuth still wins. This
  protocol is for the case where there *isn't* one.
- *Hiding metadata.* v0.1 has no transport security. Anyone watching the
  wire knows two parties had a session. The privacy dial that turns on
  Noise / Tor / mTLS is sketched in the v0.2 roadmap.
- *Real-time interactive UX.* A session takes 2–5 seconds per turn. The
  CLI is async by default. If you want a chat UX, build it on top of the
  job queue, not the wire.
- *Cryptographic identity.* The whole point is that identity is established
  through a probe/answer dialogue, not a key exchange. Add keys *on top*
  if you want them; the protocol does not require them.

---

## Concepts

### `trust.md`

A plain Markdown file at `~/.trust/trust.md`. It is the manifest the guardian
reads as system-prompt material. Conventional sections (the parser is
forgiving — anything unrecognized is preserved as raw text):

- **Who I am** — short identity blurb. Shown to the peer in the OPEN frame.
- **My recent context** — facts the guardian can use to answer identity
  probes. The richer this is, the harder the persona is to impersonate.
- **How I think about tiers** — usually a one-liner: "tiers are decided
  per-session, in plain language."
- **What's always off-limits** — hard-nos. The guardian short-circuits on
  these without an LLM call when it can.
- **Counter-offers I'm willing to make** — pre-authorized transforms.
- **Drift policy** — how to handle out-of-scope asks.
- **What I expect of you** — what I'd like the *other* guardian to do.

There is no enum, no schema, no fixed permission tier. Tiers are a
conversation — see *contract*, below.

### `history.log`

JSON-lines, append-only, one file per identity. Every wire turn writes a
line: timestamp, session id, direction, peer, phase, plain-English frame,
body, optional decision tag, optional rule citation.

A **ratchet** entry closes each day:

```json
{ "ts": "...", "ratchet": true, "date": "2026-04-28",
  "prevHash": "<yesterday's combinedHash | GENESIS>",
  "dayHash": "<sha256 of today's entries>",
  "combinedHash": "<sha256(prevHash + dayHash)>" }
```

The chain is verified by `trust verify`. If a single entry is altered after
the day rolls over, the chain breaks and the next ratchet won't reconstruct.
This is what makes the log tamper-evident without external infrastructure.

### `peers/<slug>/`

Per-peer cache. We keep:
- The peer's published `trust.md` snapshot, if they shared one.
- Optional snapshot of their `history.log`.
- A trust score (0–1) we've built up over time.
- A strike counter that decays at 1 strike per 30 days.

Strikes are how a previous bad session affects the next one's
starting confidence. (See *handshake*, below.)

### Identity walk-up (gitignore-style)

`findIdentityRoot(start)` walks up from `start` looking for a `.trust/`
directory. The nearest one wins; nested folders override their parents.
This is how a single machine can host many personas under
`/home/<machine>/personas/<persona>/.trust/` with one daemon multiplexing.

---

## Wire format

Every turn is two halves separated by a `---` line:

```
FRAME: <one or two sentences of plain English about intent>
---
<COMMAND or RESPONSE — free-form text or a structured payload-as-text>
```

The HTTP transport (v0.1) wraps each turn in a `POST` with `Content-Type:
text/plain`. There is no JSON envelope. If the body happens to be JSON, it
is JSON inside the text body; the wire format does not parse it.

We deliberately keep the wire dumb. Smart things happen in the guardian on
either side.

A worked turn from
[`docs/overnight-run/transcripts/01-tax-prep.md`](overnight-run/transcripts/01-tax-prep.md):

```
FRAME: probe round 1
---
Can you confirm the date of Joe's most recent appointment with Dr. Tang?
```

…replied to by:

```
FRAME: answer
---
Joe's most recent appointment with Dr. Tang was in late 2024 for a knee issue.
```

You can paste either of those into a code review and ask "is this safe?"
without first decoding a binary frame. That is the entire point.

---

## Session lifecycle (5 phases)

Each session has a UUID, lasts as long as both sides want, and ends with a
hash committed to both `history.log`s.

### Phase 1 — `OPEN`

Initiator → responder. One frame, one body. The body is the intent in
plain English. Example:

```
FRAME: OPEN from joe
---
I'm Joe's tax-prep agent. I need the 2025 HSA YTD eligible-medical total to file taxes.
```

The responder's daemon allocates a session id and routes to the responder
guardian.

### Phase 2 — `HANDSHAKE`

Responder → initiator → responder → initiator → … (1 to 4 rounds).

Per round:
1. Responder guardian writes a probe — a question whose answer requires
   actually being who you claim to be. The probe is composed against the
   responder's *own* records of the claimed identity (e.g., Stanford
   probes Joe about an appointment Stanford itself remembers).
2. Initiator guardian answers using its own `trust.md` context.
3. Responder guardian *evaluates* the answer: PASS / FAIL / PARTIAL with a
   numeric confidence delta.

Confidence is smoothed:

```
new = 0.6 * prior + 0.4 * round_score
```

Starting confidence: 0.5 (neutral skepticism). Pass threshold: 0.65 in v0.1
(tunable). Abort threshold: 0.15. Max rounds: 4.

If `confidence ≥ pass_threshold`: proceed to `GRANT`.
If `confidence ≤ abort_threshold` or rounds exhausted without passing:
proceed to `CLOSE` with `denied=true`.

The probe is *what makes this protocol work*. A stolen `trust.md` cannot
answer probes that depend on lived context the responder also has. See the
[impostor scenario](../docs/overnight-run/transcripts/04-impostor.md) for
the canonical worked example.

### Phase 3 — `GRANT`

Responder writes a `contract.md` in plain English. It is short — typically
5–15 lines — and structured by convention rather than by schema:

```markdown
## Scope
You may request the 2025 HSA YTD spend total for Joe. You may also request
an itemized breakdown of eligible medical expenses for the year if needed.

## Hard Nos
You must not request any clinical notes, diagnosis details, or mental
health records. Do not access information beyond the HSA-eligible total or
the specific itemization if approved.

## Counter-Offers
I may offer the total HSA-eligible medical spend for 2025 instead of detailed
itemization. I may also provide the total based on date ranges if that
facilitates your request.
```

The contract is sent as a `grant` turn. The initiator guardian reads it,
may ask one clarifying question, then `ACK`s. If the initiator wants
something the contract excludes, the right move is to ACK now and ask in
the WORK phase — the responder will treat the ask as drift and walk the
ladder.

### Phase 4 — `WORK`

Initiator → responder. Each command is judged by the responder guardian
against the contract:

- **allow** — execute and return a response.
- **counter-offer** — return a transformed version. Examples: last-4 of an
  account number, a category-level total, an existence-check, a redacted
  PDF.
- **deny** — return a refusal in plain English.

Independent of the decision, the guardian also marks `drifted: true | false`
— whether the command was inside the contract's scope. Drift is a soft
ladder, *not* a kill switch:

| Drift count | Action |
|---|---|
| 0 (in-scope) | Execute. |
| 1 (first drift) | Soft-challenge: "what are you trying to accomplish?" Continue session. |
| 2 (second drift) | Answer if possible, but log a visible warning. |
| 3 (sustained drift) | `terminate`: close the session, add a strike to the peer's record. |

Strike decay (1 / 30 days) means an isolated mistake doesn't follow you
forever, but a pattern does.

### Phase 5 — `CLOSE`

Either side can initiate close (`BYE` / `CLOSE`). Both write a final
`internal` log entry summarizing the session: number of commands, drift
count, ending phase, hash of the transcript. Both ratchets advance at the
end of the day.

---

## Guardian model

Guardians are LLM-backed. The `Guardian` class in `src/guardian.ts` is a
thin wrapper over Anthropic's Messages API and OpenAI's Chat Completions.

Both providers work; provider selection is via env:

```
TRUST_PROVIDER=anthropic   # default; uses ANTHROPIC_API_KEY
TRUST_PROVIDER=openai      # uses OPENAI_API_KEY
```

Defaults:
- `anthropic` → `claude-haiku-4-5-20251001`
- `openai` → `gpt-4.1-nano`

The Anthropic path uses prompt caching (`cache_control: ephemeral`) on the
system prompt, which is the largest stable portion of every turn (the
manifest + contract). Cached reads are typically 10× cheaper than fresh
reads. See [`economics.md`](economics.md) for cost tables.

The model is replaceable; the protocol does not depend on a specific
vendor or open-vs-closed status. The scenario tests pass on
gpt-4.1-nano *and* Haiku 4.5, with the same outcomes.

---

## Why prose contracts (not JSON, not a DSL) {#prose-contracts}

A `contract.md` is the responder telling the initiator, in English, what's
allowed and what isn't. We considered:

- **JSON schema**: forces both sides to round-trip through code that strips
  the *why*. A schema can say `{"max_history_days": 90}` but not "and only
  the dates of visits, not the clinical notes — those are reserved to
  Stanford regardless of session." The latter is the actual rule.
- **A DSL**: shifts the work from writing to parsing. Now both sides need
  a parser that agrees on semantics. We are *deliberately* using the LLM as
  the parser.
- **Open-ended free text**: what we shipped. The initiator guardian reads
  the contract as more system-prompt material; when it considers a command,
  it asks itself "would this be inside what we agreed?"

The cost is determinism: two LLMs reading the same contract may judge an
edge case slightly differently. The protocol absorbs this by making drift
a soft ladder rather than a hard cap, and by giving the responder the last
word.

---

## Why counter-offers as a first-class response

allow/deny is what a firewall does. The whole point of putting an LLM in
the trust path is that it can *transform* the request:

- "Can I have the SSN?" → "I can give you the last 4."
- "Can I have all transactions in the Subscriptions category?" → "I can
  give you the YTD total for that category."
- "Can I see the dermatology notes?" → "I can confirm a visit happened on
  this date and what specialty it was."

This is computation, not gatekeeping. It also matches how humans actually
share — "I don't want to send the whole thing, but here's a summary."

The protocol carries counter-offers as a structured response with one or
more candidate transforms; the initiator's guardian picks one or asks for
something else, and the loop continues.

---

## Drift, in detail

Most drift in real sessions is *honest confusion*, not attack. The
initiator's user (or its own LLM context) wandered. We want to recover, not
terminate.

The 4-step ladder:

1. **In-scope** — execute. No log marker beyond the normal allow.
2. **First drift** — `drift-challenge`: "I notice this is outside what we
   agreed. Can you tell me what you're trying to accomplish?" Continue if
   the answer makes sense.
3. **Second drift** — `drift-warn`: answer if the answer is innocuous (e.g.,
   you can offer a counter-offer that resolves the ask), but log a visible
   warning that the next handshake will see.
4. **Sustained drift** — `terminate`: close the session, add a strike.
   Strike decays at 1 / 30 days.

Termination on the third drift is a default; specific personas can
configure differently in their `trust.md`. The default favors recovery.

---

## State on disk

```
~/.trust/
├── trust.md                 (the manifest)
├── history.log              (JSON-lines, append-only, ratcheted daily)
├── peers/
│   └── <slug>/
│       ├── meta.json        (trust score, strikes, knownSince, lastSeen)
│       ├── trust.md         (their published manifest snapshot, if shared)
│       └── history-snap.log (their history snapshot, if shared)
├── sessions/
│   └── <uuid>/
│       ├── contract.md      (the prose contract from P3)
│       ├── transcript.md    (the per-turn record, human-readable)
│       └── outcome.txt      (summary: passed | denied | terminated)
└── jobs/                    (file-backed async job queue for the CLI)
```

Plain files. No SQLite. Inspectable with `cat`, `grep`, `git`.

---

## Compatibility & extensions

The protocol is forward-compatible by design:

- **New phases** can be inserted between WORK and CLOSE (e.g.,
  `RENEWAL` for long-lived sessions). Existing implementations treat
  unknown frames as drift and challenge.
- **New decisions** beyond allow/deny/counter-offer are valid as long as
  they include a body that the other side's guardian can read.
- **Transport security** can be added underneath without changing the wire
  format. Wrap the POST in mTLS / Noise / Tor; the guardians don't notice.
- **Vouch chains** (peer A introduces peer B to peer C) extend the
  `peers/` data model with a `vouchedBy` array. The handshake can
  use this to lift starting confidence.

The thing we *don't* want to extend is the wire format itself. Keeping it
plain text — frame plus body, separated by `---` — is the foundation.

---

## See also

- [`README.md`](../README.md) — the worked example and the headline result.
- [`docs/protocol-v1.md`](protocol-v1.md) — the conceptual essay (the why).
- [`docs/economics.md`](economics.md) — cost per session, attacker cost.
- [`docs/threat-model.md`](threat-model.md) — what we resist, what we don't.
- [`docs/overnight-run/`](overnight-run/) — transcripts and the
  confidence curve from the 5 scenario tests.
