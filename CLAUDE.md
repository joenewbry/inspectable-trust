# CLAUDE.md

Guide for future Claude Code sessions in this repo. Read this *before*
running large commands or proposing changes.

## What this is

`inspectable-trust` is the implementation of a protocol for two computers
to negotiate data sharing through LLM guardians, without prior credentials
or a central authority. The README is the entry point; the technical spec
is `docs/protocol-v2.md`.

This is **v0.1** — minimal, deliberately scoped. Think small.

## Layout

```
src/
├── identity.ts        walk-up .trust/ resolver (gitignore-style nesting)
├── trust-md.ts        parse the manifest into sections
├── frame-command.ts   wire format encode/decode (FRAME + body, separated by ---)
├── history.ts         append-only log + daily ratchet
├── peers.ts           per-peer cache + strike decay
├── guardian.ts        LLM wrapper (anthropic + openai)
├── handshake.ts       multi-round probe state machine
├── contract.ts        responder writes prose contract.md
├── work-loop.ts       judge command → allow / deny / counter-offer + drift
├── session.ts         orchestrate phases: OPEN → HANDSHAKE → GRANT → WORK → CLOSE
├── daemon.ts          HTTP server: /sessions, /sessions/:id/turn, /trust.md
├── jobs.ts            file-backed async job queue for the CLI
├── cli.ts             trust init|serve|ask|history|peer|verify
└── types.ts           shared type definitions
```

```
tests/
├── unit/         60 fast tests, no API key needed (~2s, $0)
├── integration/  3 tests that hit a real LLM (~30s, ~$0.5) — gated by RUN_INTEGRATION=1
└── scenarios/    5 end-to-end scenarios with full transcripts (~3 min, ~$0.005) — gated by RUN_SCENARIOS=1
```

```
examples/
├── joe/                  the demo persona — rich life context
├── stanford-healthcare/  hospital that holds Joe's records
├── chase-mock/           bank persona
├── delta-mock/           airline persona
├── impostor-joe/         sparse manifest with no lived context — the attacker
└── demo.ts               runnable in-memory session
```

```
docs/
├── protocol-v2.md       the technical spec
├── economics.md         cost per session, attacker cost
├── threat-model.md      what we resist, what we don't
└── overnight-run/       transcripts + confidence curve from the scenario tests
```

## Conventions

- **TypeScript, ESM, Node 22.** No build step required for dev (`tsx`).
  `tsc` is for the published binary.
- **No framework.** No express, no koa, no fastify. The HTTP daemon uses
  `node:http` directly. The LLM client uses `fetch` directly. Keep it
  legible.
- **Plain files for state.** `~/.trust/` is the entire on-disk state.
  No SQLite, no Redis, no key-value store. If you reach for one, ask why.
- **Wire is plain text.** Never wrap a message in JSON for transport.
  If the body is JSON, it's JSON-as-text inside the wire body.
- **Prose over schema.** Contracts are markdown. Trust manifests are
  markdown. The LLM is the parser.

## Running things

```bash
# Tests
npm test                                              # unit only, no API
RUN_INTEGRATION=1 npm run test:integration            # +real LLM
RUN_SCENARIOS=1 npm run test:scenarios                # +5 worked sessions

# Provider selection (defaults to anthropic)
TRUST_PROVIDER=openai OPENAI_API_KEY=sk-... npm test
TRUST_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... npm test

# CLI
npm run trust -- init                                 # bootstrap ~/.trust
npm run trust -- serve examples/stanford-healthcare --port 8501
npm run trust -- ask http://127.0.0.1:8501 "intent"
```

## Provider notes

The repo supports both Anthropic and OpenAI guardians via
`TRUST_PROVIDER`. Defaults to `anthropic` with `claude-haiku-4-5-20251001`.

If you see "usage limits" errors against Anthropic and need to demo,
switch to OpenAI gpt-4.1-nano:

```bash
TRUST_PROVIDER=openai OPENAI_API_KEY=$KEY npm run test:scenarios
```

The scenario tests pass on both providers with the same outcomes —
cost differs but behavior matches. This is by design: the protocol must
not depend on a specific vendor.

## Things to be careful about

- **Don't mock the LLM in scenario tests.** The whole point of the
  scenarios is that they exercise real handshakes. Unit tests can mock;
  scenarios cannot. (The `NoCallGuardian` is for tests that should
  *never* call the LLM, e.g. hard-no short-circuit tests.)
- **Don't add fields to the wire format.** Plain text + `---` is the
  whole spec. New decisions / phases go in the *body*.
- **Don't add a build step to dev.** `tsx` runs everything; `tsc`
  builds the published binary. Adding a bundler is a v0.2 conversation.
- **Don't introduce a new dep without justification.** The whole library
  is `@anthropic-ai/sdk` (currently unused at runtime — we use `fetch`
  directly), `vitest` (tests), `tsx` and `typescript` (dev). Keep it
  minimal.
- **Don't write to `examples/<persona>/.trust/` from tests.** Tests must
  copy the persona to a temp dir first. See `tests/integration/_fixture.ts`
  for the helper.

## Style

- Comments explain *why*, not what. The code is short enough that the
  what is self-evident.
- One concept per file. If a file is doing two things, split it.
- No console.log in committed code outside of `cli.ts` and `daemon.ts`.
  Tests use `console.log` freely; library code does not.
- Errors throw plain `Error`. No custom error classes for v0.1.

## Where to look first

If a contributor is investigating a specific concern:

| Concern | Look at |
|---|---|
| "How does the wire work?" | `src/frame-command.ts`, `tests/unit/frame-command.test.ts` |
| "How does the handshake decide pass/fail?" | `src/handshake.ts` (especially `parseEvaluation` and the smoothing) |
| "How does the responder write the contract?" | `src/contract.ts` |
| "How does drift get judged?" | `src/work-loop.ts` (especially the `DriftState` machine) |
| "How are sessions orchestrated?" | `src/session.ts` (the `step(inbound) → outbound` state machine) |
| "How does the daemon serve multiple personas?" | `src/daemon.ts` and `src/identity.ts` |
| "What does a transcript look like?" | `docs/overnight-run/transcripts/*.md` |

## When in doubt

Ask before:
- adding a new dependency
- adding a new file outside `src/`
- changing the wire format
- adding a new phase
- adding transport security (that's a v0.2 conversation, not a one-line PR)
- changing the default model or provider

These are deliberate constraints, not oversight.
