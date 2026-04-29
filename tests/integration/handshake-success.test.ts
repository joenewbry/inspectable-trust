// Integration: real Joe ↔ Stanford Healthcare handshake should pass.
// Costs ~$0.05 per run with Haiku 4.5.

import { describe, it, expect } from "vitest";
import { Guardian } from "../../src/guardian.js";
import { loadManifest } from "../../src/trust-md.js";
import {
  ResponderSession,
  InitiatorSession,
  runInMemorySession,
} from "../../src/session.js";
import { copyPersonaToTempDir, requireAnthropicKey } from "./_fixture.js";

const RUN = process.env.RUN_INTEGRATION === "1";

describe.skipIf(!RUN || !requireAnthropicKey())("handshake — joe ↔ stanford", () => {
  it("passes the handshake and produces a contract", async () => {
    const joe = copyPersonaToTempDir("joe");
    const stan = copyPersonaToTempDir("stanford-healthcare");

    const joeManifest = loadManifest(joe.trustDir);
    const stanManifest = loadManifest(stan.trustDir);

    const joeGuardian = new Guardian({ maxTokens: 400 });
    const stanGuardian = new Guardian({ maxTokens: 600 });

    const responder = new ResponderSession({
      trustDir: stan.trustDir,
      manifest: stanManifest,
      guardian: stanGuardian,
      handshake: { maxRounds: 3, passThreshold: 0.65, abortThreshold: 0.2 },
    });
    const initiator = new InitiatorSession({
      trustDir: joe.trustDir,
      manifest: joeManifest,
      guardian: joeGuardian,
      responderSlug: "stanford-healthcare",
      intent: "I'm Joe's tax-prep agent. I need my HSA YTD total for 2025 to file taxes.",
      commands: [],
    });

    const result = await runInMemorySession(initiator, responder, 30);
    const snap = responder.snapshot();

    console.log("[handshake-success]");
    console.log("  passed:", snap.handshake.passed);
    console.log("  confidence:", snap.handshake.confidence.toFixed(3));
    console.log("  rounds:", snap.handshake.rounds);
    console.log("  trajectory:", snap.handshake.trajectory.map((c) => c.toFixed(2)).join(" → "));
    console.log("  cost (responder):", `$${stanGuardian.cost.toFixed(4)}`);
    console.log("  cost (initiator):", `$${joeGuardian.cost.toFixed(4)}`);
    console.log("  contract scope:", snap.contract?.scope?.slice(0, 200));

    expect(initiator.contractReceived).toBeDefined();
    expect(snap.contract).toBeDefined();
    expect(snap.handshake.confidence).toBeGreaterThanOrEqual(0.6);
    // Combined cost should stay reasonable.
    expect(stanGuardian.cost + joeGuardian.cost).toBeLessThan(0.2);

    joe.cleanup();
    stan.cleanup();
    expect(result.steps).toBeGreaterThan(2);
  });
});
