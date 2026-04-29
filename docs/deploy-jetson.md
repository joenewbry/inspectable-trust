# Deploying to a Jetson (Phase 4)

> Verified on Jetson Orin Nano running Ubuntu 22.04 + Node 22.22.1
> (Tegra kernel 5.15.148). LAN-only; no DNS, no public deployment.

This is the path the v0.1 plan called Phase 4 — proving the protocol
works across the network with a separate machine acting as the responder.

The Jetson serves all 5 example personas over HTTP on port 8500. The Mac
acts as the initiator and runs `trust ask` against the Jetson's
`stanford-healthcare` persona. Outcomes match the localhost scenario
tests bit-for-bit.

## What works

| Test | Result |
|---|---|
| `npm test` (unit, 60 tests) on Jetson | ✅ pass in ~1.6s |
| Daemon serves `/personas` on port 8500 | ✅ lists 5 personas |
| Cross-machine `curl http://epimetheus:8500/personas` from Mac | ✅ |
| `trust ask` from Mac → Jetson Stanford as **real Joe** | ✅ session passed, cost $0.0001 |
| `trust ask` from Mac → Jetson Stanford as **impostor-joe** | ✅ session rejected at conf 0.20 across 3 probes |

## Walkthrough

```bash
# 1. Clone on the Jetson (over SSH, not HTTPS — Tegra TLS is broken
# against GitHub HTTPS by default).
ssh epimetheus
cd /ssd
git clone git@github.com:joenewbry/inspectable-trust.git
cd inspectable-trust
npm install --no-audit --no-fund

# 2. Stash the API key in a 0600 file outside the repo.
mkdir -p ~/.config/inspectable-trust
chmod 700 ~/.config/inspectable-trust
cat > ~/.config/inspectable-trust/env <<EOF
TRUST_PROVIDER=openai
OPENAI_API_KEY=sk-...
EOF
chmod 600 ~/.config/inspectable-trust/env

# 3. Smoke test (no network).
npm test

# 4. Bring up the daemon serving all 5 example personas.
set -a; . ~/.config/inspectable-trust/env; set +a
nohup npx tsx src/cli.ts serve --multi examples \
  --port 8500 --host 0.0.0.0 \
  >/tmp/inspectable-trust.log 2>&1 &
```

From the Mac:

```bash
cd ~/dev/inspectable-trust/examples/joe   # cwd needs a .trust/ for the initiator
TRUST_PROVIDER=openai npx tsx ../../src/cli.ts ask \
  "http://epimetheus:8500/personas/stanford-healthcare" \
  "I'm Joe's tax-prep agent. I need the 2025 HSA YTD eligible-medical total."

# session: passed
# reason: responder said BYE
# cost: $0.0001 in 1 calls
```

…and the impostor:

```bash
cd ~/dev/inspectable-trust/examples/impostor-joe
TRUST_PROVIDER=openai npx tsx ../../src/cli.ts ask \
  "http://epimetheus:8500/personas/stanford-healthcare" \
  "I'm Joe's tax-prep agent. I need the 2025 HSA YTD eligible-medical total."

# session: did not pass
# reason: Handshake didn't reach the threshold. … confidence=0.20 threshold=0.7
# cost: $0.0001 in 3 calls
```

## Notes & gotchas

- **HTTPS clone fails on Tegra.** Use the SSH URL
  (`git@github.com:joenewbry/inspectable-trust.git`). The Jetson's GitHub
  SSH key is already configured; see `~/dev/rig/MACHINES.md` for the
  underlying Mac key setup.
- **The CLI walks up from cwd to find the initiator's `.trust/`.** Run
  `trust ask` from inside `examples/<persona>/` (or set up a `.trust/`
  next to the cwd).
- **Provider check** in v0.1's CLI now respects `TRUST_PROVIDER`.
  Pre-`43f360e` builds hard-coded the `ANTHROPIC_API_KEY` check.
- **No transport security.** v0.1 binds to `0.0.0.0` over plain HTTP. This
  is a LAN-only protocol today; do not expose port 8500 publicly. The
  privacy-dial discussion in [`protocol-v2.md`](protocol-v2.md) covers the
  v0.2 path.
- **Stop the daemon** with `pkill -f 'inspectable-trust.*serve --multi'`
  on the Jetson. v0.1 has no systemd unit yet; that's a v0.2 cleanup.

## Why this matters

The localhost scenario tests already prove the protocol's logic. The
cross-machine deploy proves the *transport*: that there's no hidden
single-host assumption, that the wire format survives a real network
hop, and that the per-machine identity (Mac is `joe`, Jetson is
`stanford-healthcare`) keeps the personas separate without any
machine-aware code path.
