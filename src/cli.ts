#!/usr/bin/env node
// trust — the inspectable-trust CLI.
//
//   trust init [path]              create ~/.trust/ (or path/.trust/) with starter trust.md
//   trust serve [path]             start the daemon for the persona at path (default: walk up from cwd)
//   trust serve --multi <dir>      start the daemon serving every <dir>/*/.trust/
//   trust ask <peer> "<question>"  open a session, ask a question, print the answer
//   trust history                  cat the local persona's history.log (last 200 entries)
//   trust peer <slug>              show what we know about a peer
//   trust verify                   verify the ratchet chain on the local history.log

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";
import { findIdentityRoot } from "./identity.js";
import { loadManifest } from "./trust-md.js";
import { ensureLog, readEntries, verifyChain } from "./history.js";
import { loadPeer, effectiveStrikes } from "./peers.js";
import { startDaemon, startClientSession } from "./daemon.js";
import { Guardian } from "./guardian.js";
import { InitiatorSession } from "./session.js";

async function main() {
  const args = argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case "init":
      return cmdInit(args[1]);
    case "serve":
      return cmdServe(args.slice(1));
    case "ask":
      return await cmdAsk(args.slice(1));
    case "history":
      return cmdHistory();
    case "peer":
      return cmdPeer(args[1]);
    case "verify":
      return cmdVerify();
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return help();
    default:
      stderr.write(`Unknown command: ${cmd}\n`);
      help();
      exit(1);
  }
}

function help() {
  stdout.write(`trust — inspectable-trust CLI

  trust init [path]                Create .trust/ with a starter trust.md.
                                   Default path: ~ (your home directory).

  trust serve [path]               Start the daemon for the persona at <path>
                                   (or walking up from cwd).
  trust serve --multi <dir>        Start daemon serving every <dir>/*/.trust/.
  trust serve --port <n>           Bind to port <n>. Default 8500.
  trust serve --host <h>           Bind to host. Default 127.0.0.1.

  trust ask <peer-url> "<intent>"  Open a session and walk through it.
                                   peer-url is http://host:port[/personas/<slug>].
                                   Reads further commands from stdin, one per line.

  trust history                    Tail the local history.log (last 200 entries).
  trust peer <slug>                Show what we know about a peer.
  trust verify                     Verify the ratchet chain on the local log.

Environment:
  ANTHROPIC_API_KEY                Required for any LLM-backed action.
  TRUST_MODEL                      Override model. Default claude-haiku-4-5-20251001.
`);
}

function cmdInit(rawPath?: string) {
  const target = resolve(rawPath ?? homedir());
  const trustDir = join(target, ".trust");
  if (existsSync(trustDir)) {
    stderr.write(`Already exists: ${trustDir}\n`);
    exit(1);
  }
  mkdirSync(trustDir, { recursive: true });
  mkdirSync(join(trustDir, "peers"), { recursive: true });
  mkdirSync(join(trustDir, "sessions"), { recursive: true });
  mkdirSync(join(trustDir, "jobs"), { recursive: true });
  ensureLog(trustDir);

  const slug = target === homedir() ? "you" : target.split("/").pop() ?? "you";
  const starter = STARTER_TRUST_MD.replace(/__SLUG__/g, slug);
  writeFileSync(join(trustDir, "trust.md"), starter, "utf8");

  stdout.write(`Created ${trustDir}\n`);
  stdout.write(`Edit ${trustDir}/trust.md to describe yourself.\n`);
}

function cmdServe(args: string[]) {
  if (!env.ANTHROPIC_API_KEY) {
    stderr.write("ANTHROPIC_API_KEY not set in environment.\n");
    exit(1);
  }
  let root: string | undefined;
  let multi: string | undefined;
  let port = 8500;
  let host = "127.0.0.1";

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--multi") multi = args[++i];
    else if (a === "--port") port = Number(args[++i]);
    else if (a === "--host") host = args[++i];
    else if (!a.startsWith("--")) root = a;
  }

  if (!root && !multi) {
    const id = findIdentityRoot(process.cwd());
    if (!id) {
      stderr.write("No .trust/ found in cwd or its ancestors. Pass a path or use --multi.\n");
      exit(1);
    }
    root = id.identityDir;
  }

  startDaemon({ root, multi, port, host });
  // Keep the process alive.
  setInterval(() => {}, 1 << 30);
}

async function cmdAsk(args: string[]) {
  if (!env.ANTHROPIC_API_KEY) {
    stderr.write("ANTHROPIC_API_KEY not set.\n");
    exit(1);
  }
  if (args.length < 2) {
    stderr.write('usage: trust ask <peer-url> "<intent>"\n');
    exit(1);
  }
  const peerUrl = args[0]!;
  const intent = args[1]!;
  const id = findIdentityRoot(process.cwd());
  if (!id) {
    stderr.write("No local .trust/ found. Run `trust init` first.\n");
    exit(1);
  }
  const manifest = loadManifest(id.trustDir);
  ensureLog(id.trustDir);
  const guardian = new Guardian();

  // Parse peer-url. Expected forms:
  //   http://host:port            (single-persona)
  //   http://host:port/personas/<slug>   (multi-persona)
  const m = peerUrl.match(/^(https?:\/\/[^\/]+)(?:\/personas\/([^\/]+))?\/?$/);
  if (!m) {
    stderr.write(`Bad peer URL: ${peerUrl}\n`);
    exit(1);
  }
  const baseUrl = m![1]!;
  const slug = m![2];

  // For now, no further commands beyond intent. The session does just OPEN +
  // handshake + GRANT + immediate CLOSE.
  const initiator = new InitiatorSession({
    trustDir: id.trustDir,
    manifest,
    guardian,
    responderSlug: slug ?? "peer",
    intent,
    commands: [], // empty → goes straight to CLOSE after handshake/grant
  });

  const opts: { baseUrl: string; slug?: string } = { baseUrl };
  if (slug) opts.slug = slug;
  const { session, firstReply } = await startClientSession(opts, initiator.openMessage());

  let inbound = firstReply.outbound;
  let done = firstReply.done;
  let step = 0;
  while (!done && step < 60) {
    const next = await initiator.respond(inbound);
    if (next === null) break;
    const r = await session.postTurn(next);
    inbound = r.outbound;
    done = r.done;
    step += 1;
  }
  // Process the very last inbound (in case it's BYE/TERMINATE).
  await initiator.respond(inbound).catch(() => undefined);

  stdout.write(`session: ${initiator.contractReceived ? "passed" : "did not pass"}\n`);
  stdout.write(`reason: ${initiator.reason || "(no specific reason)"}\n`);
  stdout.write(`cost: $${guardian.cost.toFixed(4)} in ${guardian.calls} calls\n`);
  if (initiator.contractReceived) {
    stdout.write(`\n--- contract ---\n${initiator.contractReceived}\n`);
  }
}

function cmdHistory() {
  const id = findIdentityRoot(process.cwd());
  if (!id) {
    stderr.write("No local .trust/ found.\n");
    exit(1);
  }
  const entries = readEntries(id.trustDir);
  const tail = entries.slice(-200);
  for (const e of tail) {
    stdout.write(JSON.stringify(e) + "\n");
  }
}

function cmdPeer(slug?: string) {
  if (!slug) {
    stderr.write("usage: trust peer <slug>\n");
    exit(1);
  }
  const id = findIdentityRoot(process.cwd());
  if (!id) {
    stderr.write("No local .trust/ found.\n");
    exit(1);
  }
  const peer = loadPeer(id.trustDir, slug);
  if (!peer) {
    stdout.write(`No record for peer "${slug}".\n`);
    return;
  }
  stdout.write(JSON.stringify({ ...peer, effectiveStrikes: effectiveStrikes(peer) }, null, 2) + "\n");
}

function cmdVerify() {
  const id = findIdentityRoot(process.cwd());
  if (!id) {
    stderr.write("No local .trust/ found.\n");
    exit(1);
  }
  const err = verifyChain(id.trustDir);
  if (err) {
    stdout.write(`BROKEN: ${err}\n`);
    exit(1);
  }
  stdout.write("ratchet chain intact\n");
}

const STARTER_TRUST_MD = `# __SLUG__'s trust.md

This is the manifest that lives at \`~/.trust/trust.md\` on my machine. Both my
guardian and any visiting guardian read it to understand who I am, what I'm
willing to share, and on what terms. It's plain Markdown on purpose.

## Who I am

(Edit this section. Tell visitors who you are, what kind of agent represents
you, and how to verify they're talking to the real you.)

## How I think about tiers

I don't have a fixed list of permission levels. Tiers are decided per-session,
in plain language, by my guardian responding to your declared intent.

## What's always off-limits

- Full SSN, full account numbers, full credit card numbers
- The contents of \`~/personal/\` and \`~/Documents/private/\`
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

## What I expect of you

If you're a guardian on the other end of a session with me:
- Tell me who you're operating for, in plain language.
- Tell me what you're trying to accomplish.
- Don't probe for things outside that goal.
- Honor my counter-offers when I make them.
- Keep your own append-only log of our exchanges.

I'll do the same.
`;

main().catch((err) => {
  stderr.write((err as Error).stack + "\n");
  exit(1);
});
