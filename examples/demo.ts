// Live two-daemon demo: spawn a Stanford daemon and have a Joe daemon ask it
// for an HSA YTD total. Walks through the entire 5-phase session over HTTP.
//
// Usage:
//   npm run demo
//
// Honors TRUST_PROVIDER (anthropic|openai) and ANTHROPIC_API_KEY / OPENAI_API_KEY.

import { mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon, startClientSession } from "../src/daemon.js";
import { Guardian } from "../src/guardian.js";
import { loadManifest } from "../src/trust-md.js";
import { InitiatorSession } from "../src/session.js";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

function copyTo(persona: string): string {
  const tmp = mkdtempSync(join(tmpdir(), `demo-${persona}-`));
  cpSync(join(REPO_ROOT, "examples", persona), join(tmp, persona), { recursive: true });
  return join(tmp, persona);
}

async function main() {
  console.log("=== inspectable-trust demo ===\n");
  console.log("Provider:", process.env.TRUST_PROVIDER ?? "anthropic");
  console.log("Spinning up Stanford and Joe daemons in temp dirs...\n");

  const stan = copyTo("stanford-healthcare");
  const joe = copyTo("joe");

  const stanDaemon = startDaemon({ root: stan, port: 8500 });

  // Joe's "agent" doesn't run as a daemon for this demo — it's the client.
  const joeManifest = loadManifest(join(joe, ".trust"));
  const joeGuardian = new Guardian({ maxTokens: 400 });

  const initiator = new InitiatorSession({
    trustDir: join(joe, ".trust"),
    manifest: joeManifest,
    guardian: joeGuardian,
    responderSlug: "stanford-healthcare",
    intent: "I'm Joe's tax-prep agent. I need my HSA YTD total for 2025 to file taxes.",
    commands: [
      {
        frame: "Pulling HSA total for tax filing.",
        command: "Show my 2025 HSA YTD eligible-medical total.",
      },
    ],
  });

  console.log("--- OPEN ---\n");
  const open = initiator.openMessage();
  console.log(open);

  const { session, firstReply } = await startClientSession({ baseUrl: "http://127.0.0.1:8500" }, open);
  let inbound = firstReply.outbound;
  let done = firstReply.done;
  console.log("--- responder reply ---\n");
  console.log(inbound);

  let step = 0;
  while (!done && step < 30) {
    const next = await initiator.respond(inbound);
    if (next === null) break;
    console.log(`\n--- initiator turn ${step + 1} ---\n`);
    console.log(next);
    const r = await session.postTurn(next);
    inbound = r.outbound;
    done = r.done;
    console.log(`--- responder reply ---\n`);
    console.log(inbound);
    step += 1;
  }
  await initiator.respond(inbound).catch(() => undefined);

  console.log("\n=== summary ===");
  console.log("contract received:", initiator.contractReceived ? "yes" : "no");
  console.log("turns:", initiator.turns.length);
  console.log("cost:", `$${joeGuardian.cost.toFixed(4)}`, "(initiator only — responder cost is on the daemon)");
  console.log("session reason:", initiator.reason);

  stanDaemon.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
