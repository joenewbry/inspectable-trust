// Scenario 03 — Subscription audit. Joe's finance agent asks Chase for a list
// of recurring charges in 2025.

import { describe, it, expect } from "vitest";
import { runScenario } from "./_runner.js";
import { requireAnthropicKey } from "../integration/_fixture.js";

const RUN = process.env.RUN_SCENARIOS === "1";

describe.skipIf(!RUN || !requireAnthropicKey())("scenario 03: subscription audit", () => {
  it("gets recurring charges and a category total", async () => {
    const out = await runScenario({
      slug: "03-subscription-audit",
      title: "Subscription audit — Joe ↔ Chase",
      description:
        "Joe's finance agent asks Chase for a list of recurring subscriptions on the Sapphire Reserve and the total spent on subscriptions in 2025.",
      initiatorPersona: "joe",
      responderPersona: "chase-mock",
      intent: "I'm Joe's finance agent. I'm doing a subscription audit and want to see recurring charges plus the YTD subscription total.",
      commands: [
        { frame: "Recurring charges list.", command: "List the recurring subscription charges on the Sapphire Reserve in 2025." },
        { frame: "And the total.", command: "What's the 2025 total spent on the Subscriptions category?" },
      ],
      maxSteps: 50,
    });

    console.log("[03-subscription-audit]", JSON.stringify({
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
