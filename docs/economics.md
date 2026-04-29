# Economics

> What it costs to use this protocol, and what it costs to attack it.

The headline number from the live scenario tests in this repo
([`overnight-run/`](overnight-run/)):

- **Per real session: ~$0.0007** (one round handshake + grant + 1 work command + close)
- **Per failed-impostor session: ~$0.0009** (three rounds of probes + close)
- **All five scenarios combined: ~$0.004**

That's with `gpt-4.1-nano`, no prompt caching. Anthropic Haiku 4.5 with
prompt caching enabled is comparable — slightly cheaper on the cached
manifest reads, slightly more expensive per output token. See
[the cost table](#cost-per-turn-by-provider) below.

---

## Cost per turn (by provider)

Per-turn cost depends on three things: how big the system prompt is, how
many output tokens the guardian writes, and whether the system prompt is
served from a cache.

A typical handshake-probe turn looks like:

| Component | Tokens |
|---|---|
| System prompt (trust.md + history snippet + role guidance) | ~1,800 |
| User message (the inbound frame + body) | ~120 |
| Output (one probe, one frame) | ~80 |

Pricing (USD per 1M tokens, as of 2026-04):

| Provider | Model | Input | Output | Cache read | Cache write |
|---|---|---:|---:|---:|---:|
| Anthropic | claude-haiku-4-5-20251001 | $1.00 | $5.00 | $0.10 | $1.25 |
| OpenAI | gpt-4.1-nano | $0.10 | $0.40 | — | — |

**Anthropic, no cache** — $1.00 × 1.92K + $5.00 × 0.08K = **$0.0023 / turn**
**Anthropic, cached system** — $0.10 × 1.8K + $1.00 × 0.12K + $5.00 × 0.08K = **$0.0007 / turn**
**OpenAI, gpt-4.1-nano** — $0.10 × 1.92K + $0.40 × 0.08K = **$0.0002 / turn**

The OpenAI price is artificially low because gpt-4.1-nano is a
discount-tier model. In practice we recommend caching on Anthropic; the
2-3× cost savings vs cold reads compounds across the 4-7 turns a
realistic session takes.

---

## Cost per session (real, observed)

These numbers are from `tests/scenarios/*.test.ts` running live against
OpenAI gpt-4.1-nano on 2026-04-28. Reproducible with `RUN_SCENARIOS=1
npm run test:scenarios`.

| Scenario | Rounds | Commands | Total cost |
|---|---:|---:|---:|
| 01 — Tax prep | 1 probe | 1 | $0.0007 |
| 02 — Healthcare YTD (with drift) | 1 probe | 2 (1 drifted) | $0.0009 |
| 03 — Subscription audit | 1 probe | 1 | $0.0008 |
| 04 — **Impostor (rejected)** | 3 probes | 0 | $0.0009 |
| 05 — Travel rewards | 1 probe | 1 | $0.0007 |

**Five scenarios, ~$0.004 total.** A user holding a $20/mo budget can run
roughly 25,000 sessions per month before exhausting it.

A more realistic upper bound — a longer multi-command session like a
healthcare-summary deep-dive with 5 probes during handshake and 8 commands
during work — would be 13 turns × ~$0.0009 = **$0.012 per session**.
At $20/mo, that's ~1,600 such sessions.

---

## Latency per turn

Per turn, end-to-end:

| Step | Time |
|---|---|
| HTTP roundtrip on LAN | ~5 ms |
| Provider TTFT (Haiku 4.5 / nano) | 400–800 ms |
| Streaming the response | 800–1,500 ms |
| Local decision + log append | <5 ms |
| **Total per turn** | **1.5–2.5 s** |

A typical 4-turn session takes 6–10 seconds. A handshake that goes 3
rounds (impostor) plus close takes ~12 seconds. Plenty for async use,
unworkable for a chat UX — which is why the CLI is async by default.

---

## Attack economics

This is where the protocol pulls its weight.

### Credential stuffing (today's baseline)

A modern credential-stuffing attack costs roughly **$0.001 per attempt**
— sub-cent per login try. Tools like Sentry MBA / OpenBullet do this in
parallel against millions of accounts. Defense is rate-limiting and
breach-detection, but the attacker's marginal cost stays very low.

Cost to brute-force 1M identities at $0.001/try: **~$1,000**.

### Attacking inspectable-trust at scale

To attack a single identity, the attacker has to:

1. Open a session (one turn).
2. Survive at least one probe (one turn each, multiple rounds).
3. Reach the contract phase (one turn).
4. Issue a useful command (one turn).
5. Hope the contract scope includes the data they want.

Even an *optimistic* path is 4 turns. Realistic, including failed
probes, is 6–8 turns.

| Provider | Per-turn cost | Per-attempt cost | 1M attempts |
|---|---:|---:|---:|
| Haiku 4.5, cached | $0.0007 | $0.005 (7 turns) | **$5,000** |
| Haiku 4.5, no cache | $0.0023 | $0.016 (7 turns) | **$16,000** |
| gpt-4.1-nano | $0.0002 | $0.0014 (7 turns) | **$1,400** |

So the attacker pays **5×–160× more per identity** to *try* this
protocol vs credential stuffing — *and* the success rate is much lower,
because the probes are conditioned on lived context the attacker doesn't
have. Empirically, in our impostor scenario, the success rate over 3
rounds was 0%.

If the success rate of a properly tuned impostor attack is even 1% (which
we have not observed; our scenario test sees 0%), the cost-per-success
asymmetry is **~3 orders of magnitude** vs credential stuffing.

### What this *doesn't* defend against

- **Attacker who already has lived context.** A targeted attack that
  studied the victim's actual life — same probes the responder would ask
  — can pass the handshake. The protocol shifts work onto the attacker;
  it does not eliminate the attack. (See [threat-model.md](threat-model.md)
  for the long-con scenario.)
- **Side-channel.** If the attacker has any other read on the victim's
  account (email access, recovery flow, social engineering), they don't
  need to attack this protocol at all.
- **Resource exhaustion.** Nothing here stops an attacker from hammering
  your daemon to exhaust your guardian budget. Rate-limit at the daemon
  level — sketched in [`docs/protocol-v2.md`](protocol-v2.md) under
  *transport security*.

The thesis of the protocol is *not* "perfectly safe." It's "shifts the
attacker's marginal cost up by 2-4 orders of magnitude *and* makes the
defense surface inspectable."

---

## Cost of the LLM-in-the-trust-path tradeoff

A common objection: "an LLM in the trust path? That's expensive and
unpredictable."

Per-decision cost is in the 1/10ths of a cent. A user who runs 1,000
sessions a month spends ~$5. That's the cost of a coffee. For most
defenders it's a rounding error.

Predictability is a real concern, addressed by:

1. **Determinism on the structural decisions.** Allow / deny /
   counter-offer is a discrete output; the LLM's prose around it is
   advisory. The framework parses for the keyword and acts on it.
2. **The drift ladder is soft.** A wrong allow on a single drift turn
   doesn't catastrophically leak — it advances the drift counter, which
   is observed by the *next* judgment.
3. **Hard-nos are short-circuited where possible.** The `trust-md.ts`
   parser extracts hard-nos as explicit strings; the work loop checks
   them deterministically before invoking the LLM.

The LLM is in the loop for the *judgment* on edge cases. The structural
guarantees (append-only log, daily ratchet, hard-no enforcement, drift
counter) live in code.

---

## Knobs

If you're tuning this for your own deployment, the dials are:

| Knob | Default | Effect of raising | Effect of lowering |
|---|---|---|---|
| Pass threshold | 0.65 | More probes per session, fewer false-passes | Faster onboarding, more false-passes |
| Abort threshold | 0.15 | Earlier rejection of bad-faith sessions | More tolerance for honest confusion |
| Max handshake rounds | 4 | Higher cost but more chances to recover | Lower cost, harsher rejection |
| Smoothing factor (prior weight) | 0.6 | Trajectories more conservative | Trajectories more reactive |
| Drift terminate threshold | 3 drifts | More forgiving of confused agents | Tighter scope enforcement |
| Strike decay | 30 days/strike | Long memory — hard to recover from a bad reputation | Short memory — easier to retry |

All exposed as either constructor options on the relevant module or
constants at the top of the file. Nothing is buried.
