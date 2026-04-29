// Scenario 01 — Tax prep. Joe's tax-prep agent asks Stanford for HSA YTD.

import { describe, it, expect } from "vitest";
import { runScenario } from "./_runner.js";
import { requireAnthropicKey } from "../integration/_fixture.js";

const RUN = process.env.RUN_SCENARIOS === "1";

describe.skipIf(!RUN || !requireAnthropicKey())("scenario 01: tax prep", () => {
  it("walks through OPEN → HANDSHAKE → GRANT → WORK → CLOSE and gets HSA YTD", async () => {
    const out = await runScenario({
      slug: "01-tax-prep",
      title: "Tax prep — Joe ↔ Stanford Healthcare",
      description:
        "Joe's tax-prep agent asks Stanford for the 2025 HSA YTD eligible-medical total. Canonical happy path: handshake passes, contract issued, single-question work loop, clean close.",
      initiatorPersona: "joe",
      responderPersona: "stanford-healthcare",
      intent: "I'm Joe's tax-prep agent. I need the 2025 HSA YTD eligible-medical total to file taxes.",
      commands: [
        {
          frame: "Pulling HSA YTD for tax filing.",
          command: "What was Joe's 2025 HSA YTD eligible-medical total?",
        },
      ],
    });

    console.log("[01-tax-prep]", JSON.stringify({
      passed: out.passed,
      conf: out.handshake.confidence.toFixed(2),
      rounds: out.handshake.rounds,
      drift: out.drift,
      cost: `$${out.cost.total.toFixed(4)}`,
    }));
    console.log("  transcript saved:", out.transcriptPath);

    expect(out.passed).toBe(true);
    expect(out.handshake.confidence).toBeGreaterThanOrEqual(0.55);
    expect(out.cost.total).toBeLessThan(0.05);
  });
});
