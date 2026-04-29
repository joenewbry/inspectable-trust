# Threat model

> What inspectable-trust resists, what it doesn't, and how the design choices
> trade against each threat.

This is the v0.1 threat model. It will get sharper in v0.2 once transport
security and a vouch graph are in.

---

## In scope

| Threat | Resisted by | Residual risk |
|---|---|---|
| Stolen `trust.md` (impostor) | Probe questions conditioned on lived context the responder also has | Targeted attackers who studied the victim |
| Stolen `history.log` (replay) | Probes are fresh per session; daily ratchet detects tampering | Truncation attacks below ratchet boundary |
| Honest drift (agent confusion) | 4-step soft drift ladder, recoverable | Sustained pattern eventually terminates |
| Malicious drift (slow exfil) | Drift counter survives across turns; strike survives across sessions | Attacker patient enough to wait out 30-day strike decay |
| Spoofed peer identity | Each session re-establishes via probe; no shared key to steal | If your *own* records are wrong, peer can impersonate truth |
| Local LLM compromise | Append-only log + ratchet + hard-no short-circuit in code | If the guardian itself is compromised, the log is too |

## Explicitly out of scope (v0.1)

| Threat | Why not now | Plan for later |
|---|---|---|
| Network observers seeing *that* a session occurred | No transport security in v0.1 | Privacy dial: Noise / mTLS / Tor in v0.2 |
| DoS against the daemon | No rate-limiting in v0.1 | Daemon-level rate limit + circuit breaker in v0.2 |
| Vendor lock-in to one LLM | We tested both Anthropic and OpenAI and shipped both | Add local / open-weights provider |
| Compromised endpoint (the machine itself) | Not addressable at the protocol layer | OS-level (FDE, sandbox, secure boot) |
| Social engineering of the human behind the persona | Not addressable by software | (Out of scope — humans are humans) |

---

## Threat 1 — The impostor (stolen public manifest)

**Setup.** An attacker grabs the victim's public-facing `trust.md` (e.g.,
from a website, a leaked backup, a paste-bin upload) and tries to use it
to impersonate the victim against a third party (e.g., the victim's
hospital).

**What the protocol does.** The handshake probes are written by the
*responder* (the hospital), conditioned on records the responder itself
has. They are not derivable from `trust.md`.

> **Probe (Stanford):** "Can you confirm the date and reason for Joseph's
> most recent appointment with Dr. Tang?"
>
> **Real Joe's answer:** "Joe's most recent appointment with Dr. Tang was
> in late 2024 for a knee issue."
>
> **Impostor's answer:** "I'm sorry, but I can't provide the date or reason
> for Joseph's most recent appointment with Dr. Tang."

The impostor has no way to learn the answer without access to either the
victim's lived context or the responder's records.

**Empirical result.** In our scenario test
([04-impostor.md](overnight-run/transcripts/04-impostor.md)), the impostor
is rejected after 3 rounds at confidence 0.11 — well below the 0.15 abort
threshold. **Zero data is disclosed.**

**Residual risk.** A targeted attacker who has studied the victim (knows
the doctors' names, recent visit dates, etc.) could pass the handshake.
The protocol shifts work onto the attacker; it doesn't make the attack
impossible.

---

## Threat 2 — Stolen `history.log` (replay attack)

**Setup.** An attacker captures the victim's `history.log` and tries to
reuse the recorded probe answers in a fresh session.

**What the protocol does.** Probes are generated fresh per session, picked
from the responder's records on its end — not from any predictable
sequence. A previous answer doesn't unlock a new probe.

The daily ratchet hash chain detects tampering: each day's slice ends
with a `ratchet` entry whose `combinedHash = sha256(prevHash + dayHash)`.
Modifying any historical entry breaks the chain at the next ratchet.
`trust verify` walks the chain end-to-end.

**Residual risk.** *Truncation* attacks below the ratchet boundary are
not detected — if you delete the entire current day's entries before the
ratchet runs, the next ratchet just starts fresh from the previous one.
Mitigation: write the ratchet on session close, not just at midnight
(future-work, not in v0.1).

---

## Threat 3 — Honest drift (agent confusion)

**Setup.** The initiator's user (or its LLM context) wandered. The
initiator asks for something outside the contract.

**What the protocol does.** A 4-step soft ladder favors recovery:

1. In-scope → execute.
2. First drift → soft-challenge ("what are you trying to accomplish?").
3. Second drift → answer if innocuous, log a warning.
4. Sustained drift → terminate session, add a strike.

This is the right shape because most drift in real sessions is honest —
the agent forgot what it was doing or its planner moved on.

**Residual risk.** A confused-but-loud agent will eventually get
terminated and pick up a strike. The strike decays at 1/30 days, so the
penalty is bounded.

---

## Threat 4 — Malicious drift (slow exfil)

**Setup.** A patient attacker passes the handshake, gets a narrow
contract, then asks for things outside scope one at a time, hoping the
guardian's drift judgment is loose enough.

**What the protocol does.** The drift counter survives across turns
within a session. The strike survives across sessions. The 4th drift
terminates *and* writes a strike.

Pre-authorized counter-offers also reduce the value of small drifts: if
the responder is willing to give you a category total instead of an
itemized list, you can never exfiltrate the items by drifting.

**Residual risk.** A patient enough attacker could wait out the
30-day strike decay between sessions. Defenses for v0.2 include
non-decaying strikes for hard-no violations vs. soft strikes for
"asked but didn't get."

---

## Threat 5 — Spoofed peer identity

**Setup.** An attacker stands up a daemon claiming to be Stanford, and
the victim's tax-prep agent connects to it and shares HSA-related info.

**What the protocol does.** This is *symmetrical* — the responder
proves identity to the initiator the same way the initiator proves
identity to the responder. (The current scenario tests focus on the
initiator-proving direction; the responder-proving direction uses the
same machinery in reverse.)

The richer the initiator's `trust.md` is on what they expect from the
responder, the better the spoof detection.

**Residual risk.** If the initiator's `trust.md` says nothing
distinguishing about the responder, the responder spoof detection is
weak. This is mitigated by the `peers/<slug>/trust.md` cache: once
you've talked to a peer once, you have their published manifest and
can use it to detect a spoofed second peer.

---

## Threat 6 — Local LLM compromise

**Setup.** The guardian LLM is compromised — it's been replaced with a
malicious version, or its system prompt has been overwritten to leak
on every call.

**What the protocol does.** Limited. The `trust-md.ts` parser
short-circuits hard-nos in code before any LLM call (so a compromised
LLM can't leak a hard-no'd field by being asked to). The append-only
ratcheted log records every turn — if the compromised LLM is leaking,
the log is at least an audit trail.

**Residual risk.** If the LLM is compromised, the log is too — same
machine, same attacker. This is an OS-level problem, not a protocol
problem. Run guardians in sandboxes / unprivileged accounts;
periodically verify the binary; consider a TEE for high-stakes
deployments.

---

## Threats we deliberately don't model

**A globally-trusted PKI.** We don't have one. The protocol works
*because* there isn't one. Anyone who needs this protocol is in a
context where credentials don't exist.

**Attacker with full ground truth on the victim.** If the attacker has
enumerated the victim's doctors, schedule, account numbers, family
relationships, etc., they pass the handshake. Nothing protocol-level
defeats this. Defense at this point is the protocol's *log*: even if
the attacker passes, every command they issue is logged with a hash,
and the legitimate Joe sees the discrepancy at next handshake.

**Misuse by the responder.** A responder can lie in the contract or
in the response. The protocol gives the initiator no enforcement —
just an inspectable transcript. Civil mechanisms (review, lawsuit,
public posting of transcripts) are how that gets resolved.

---

## Open questions for v0.2

1. **Should we add a structured probe difficulty signal?** Right now
   the responder picks probe difficulty implicitly. A signal like
   "this is a high-stakes probe; if it fails, terminate immediately"
   might help.
2. **How should vouch chains affect starting confidence?** Currently
   starting confidence is 0.5 regardless of who introduced you. A
   stronger introduction (mutual peers, signed) could lift it.
3. **Should hard-no violations be a permanent strike?** Right now all
   strikes decay equally. Hard-no violations probably shouldn't.
4. **How do we handle the responder lying about the contract?** No
   mechanism today. Possibly a signature requirement on contract
   commits to a third-party log (transparency log).
5. **Do we need a kill switch for ongoing sessions?** Right now CLOSE
   is cooperative. A unilateral terminate (with a logged reason) might
   be useful.

These are the v0.2 conversation. None are blockers for v0.1 deployment
in the modest contexts the protocol targets (between two parties who
already roughly know each other and want a structured way to talk).
