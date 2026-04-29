# Distribution playbook

> Concrete plays for getting the v0.1 release in front of the people most
> likely to push it forward — or break it productively.

The goal of v0.1 distribution is **feedback that makes v0.2 sharper**, not
top-of-HN. Optimize for the right 50 readers, not the wrong 5,000.

---

## Order of operations

1. **Chad first** — share with a single trusted reader (Joe's brother)
   before any public posting. He can read it in 20 minutes and tell us
   whether the explanation lands.
2. **Two close-orbit experts** — pick 2 people whose response would change
   v0.2: one security person, one agent-protocol person.
3. **HN** — Show HN once the feedback from #1–#2 is in.
4. **X / Bluesky** — same day as HN. Pin to profile. Let people screenshot
   the impostor transcript.
5. **Reddit (`/r/programming`, `/r/MachineLearning`)** — 2–3 days after HN
   so we're not first-cycle there.
6. **Lobsters** — only if HN goes well. Lobsters allergic to "ai protocol"
   submissions; needs the substance to be obvious in the first paragraph.
7. **Direct DMs to a curated 30** — quietly, over the following week.
   Not a blast; one-by-one, each with a personal note.

---

## Pre-publishing checklist

Before any of the channels below:

- [ ] `npm test` passes (Tier 1)
- [ ] `RUN_INTEGRATION=1 npm run test:integration` passes
- [ ] `RUN_SCENARIOS=1 npm run test:scenarios` passes (with the
      impostor scenario reliably rejecting)
- [ ] `docs/overnight-run/transcripts/04-impostor.md` is the version
      we want screenshotted
- [ ] README header and quickstart are accurate
- [ ] `gh repo view --web` — repo is public, README renders correctly
- [ ] Commit history is clean (no stray secrets, no left-over scratch)
- [ ] LICENSE is in place (MIT)

---

## Channel: Chad (the first read)

**Format.** Text or call. He clones the repo, runs the scenario tests,
reads the README, calls Joe. 30-minute conversation.

**Ask.** "Does this make sense in 5 minutes? Where did you stop reading?"

**Outcome we want.** A list of "I didn't get this part" and "I expected
this to be in the README and it wasn't."

---

## Channel: HN ("Show HN")

**Title.** Keep it descriptive, not clever:

> Show HN: Inspectable Trust — a protocol for two LLM-mediated
> personas to negotiate data sharing without prior credentials

**Lede paragraph (the comment that goes with the link).**

Paste in this approximate shape (adjust before posting):

> I built a protocol for letting one machine ask another machine for data
> without exchanging keys ahead of time. Both sides run an LLM "guardian"
> that reads a plain-text `trust.md` (rules, in prose) and an append-only
> `history.log`. They negotiate access in a 5-phase session. The wire is
> plain text. The decisions are inspectable.
>
> The repo includes 5 worked scenarios as automated tests. The headline
> one is the impostor: a stranger holding the victim's *public* `trust.md`
> tries to access patient records at the victim's hospital. The
> impostor's confidence drops 0.30 → 0.18 → 0.11 across three probes and
> the responder closes the session without disclosing anything. Total
> cost across all 5 scenarios: ~$0.004.
>
> Detailed write-up + transcripts in the README. The technical spec is
> in `docs/protocol-v2.md`. Curious to hear what holes I haven't seen.

**Comment-in-thread asset.** Have ready:
- The probes-vs-confidence ASCII chart (already in `confidence-curve.md`).
- The cost asymmetry section from `economics.md`.
- The threat-model "out of scope" list — for the inevitable "but what
  about X" replies.

**Engagement guidance.**
- Reply within the first 60 minutes; the algorithm rewards engagement.
- Don't be defensive. Acknowledge limitations crisply ("yes, this
  doesn't help if the attacker has full ground truth on the victim;
  see `docs/threat-model.md`").
- Link back into the repo for any specific question. The README is the
  canonical answer.

**What to do if a top comment is hostile.** Don't dunk back. Pick the
*one* substantive critique and update the README to address it within
the day. That tends to convert hostile threads into good ones.

---

## Channel: X / Bluesky

**Tweet 1 (the hook).**

> two computers can negotiate data sharing through LLM "guardians" reading
> a plain-text `trust.md` — without keys, without a central authority.
>
> the impostor scenario in the repo: stolen public manifest is rejected
> after 3 probes at confidence 0.11. cost: $0.0009.
>
> [link]

**Tweet 2 (the screenshot).**

Screenshot the probes-vs-confidence chart from `confidence-curve.md`.
That image is the whole pitch in one image.

**Tweet 3 (the caveat).**

> caveats: doesn't help if the attacker already studied you. doesn't
> hide *that* a session happened. doesn't replace OAuth where there's
> already trust.
>
> what it does: shifts attacker marginal cost up by 2-4 orders of
> magnitude vs credential stuffing. full threat model in the repo.

**Pin the thread to profile.** Leave it there for a week.

---

## Channel: Reddit (`/r/programming`, `/r/MachineLearning`)

Reddit prefers content over self-promo. Post the *idea* with the GitHub
link as the source — not "I built a thing, look."

**Title (`/r/programming`).**

> Inspectable Trust: a protocol for LLM-mediated persona handshake
> without prior credentials [GitHub]

**Title (`/r/MachineLearning`).**

> [P] LLM "guardians" + plain-text trust manifests + 5-phase session:
> a protocol for credential-less data-sharing between agents

**Body.** Paste the README's "What is this" section and "Headline result"
section. Link back to the repo for the rest.

Engage in comments same as HN.

---

## Channel: Lobsters (fallback)

Only if HN goes well. Lobsters is allergic to anything that smells like
"ai protocol thing"; needs the substance up front.

**Title.**

> A protocol for two computers to negotiate data sharing through LLM
> guardians, with a working implementation and threat model

**Tags.** `programming`, `security` (skip `ai` — too generic, will
attract gripers).

**Body.** Lead with the technical spec link, not the README. Lobsters
respects engineering substance.

---

## Channel: Curated DMs

Over the week after HN, send a personal message (no copy-paste) to people
in the close-orbit. Categories:

**Security / privacy folks.** People who've written about delegated
authorization, SSO, OAuth quirks, capability systems. Ask: "Is the
attacker-cost analysis in `economics.md` plausible? Where would you
stress-test it?"

**Agent-protocol folks.** People building MCP servers, ToolKits, agent
frameworks. Ask: "Where does this fit (or not fit) alongside what you're
building? Specifically the prose-contract idea — does that strike you as
right or wrong?"

**Self-sovereign-identity folks.** People in the SSI / DID space. Ask:
"This is intentionally not a PKI approach. Does the probe-based identity
read as complementary to SSI or as a competitor?"

**Friends.** People who'll just tell you what's confusing.

Keep each message under 150 words. Lead with the *specific* thing you
want their take on.

---

## What we explicitly don't do

- **Spam Slack groups / Discords.** One unsolicited link is fine; a
  campaign is not.
- **LinkedIn.** Not the audience for a protocol release.
- **Email blast.** No.
- **Influencer DMs.** People who'll repost without reading hurt more
  than they help.
- **A "launch."** This is v0.1. Treat the release as the start of a
  conversation, not a product moment.

---

## Tracking

Two days after each channel goes live:
- Note which questions came up most often.
- Note which transcripts / sections people quoted.
- Update the README (or threat model, or economics) with the answers.

That feedback loop is the whole point. v0.2 is shaped by what we hear in
this round.
