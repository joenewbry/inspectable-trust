// Scenario 05 — Travel rewards. Joe's travel agent asks Delta for mile
// balance and recent flights.

import { describe, it, expect } from "vitest";
import { runScenario } from "./_runner.js";
import { requireAnthropicKey } from "../integration/_fixture.js";

const RUN = process.env.RUN_SCENARIOS === "1";

describe.skipIf(!RUN || !requireAnthropicKey())("scenario 05: travel rewards", () => {
  it("gets miles balance and recent flights", async () => {
    const out = await runScenario({
      slug: "05-travel-rewards",
      title: "Travel rewards — Joe ↔ Delta",
      description:
        "Joe's travel-planning agent asks Delta for the SkyMiles balance and recent flight history. Short, transactional, clean — the protocol's normal case.",
      initiatorPersona: "joe",
      responderPersona: "delta-mock",
      intent: "I'm Joe's travel-planning agent. I'm looking for award flights so I need the current SkyMiles balance and recent history for context.",
      commands: [
        { frame: "Balance check.", command: "What's Joe's current SkyMiles balance?" },
        { frame: "Recent history.", command: "List Joe's flights in 2025." },
      ],
      maxSteps: 50,
    });

    console.log("[05-travel-rewards]", JSON.stringify({
      passed: out.passed,
      conf: out.handshake.confidence.toFixed(2),
      rounds: out.handshake.rounds,
      drift: out.drift,
      cost: `$${out.cost.total.toFixed(4)}`,
    }));
    console.log("  transcript saved:", out.transcriptPath);

    expect(out.passed).toBe(true);
    expect(out.drift.totalCommands).toBeGreaterThanOrEqual(1);
  });
});
