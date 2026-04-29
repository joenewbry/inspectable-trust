import { describe, it, expect } from "vitest";
import {
  parseEvaluation,
  runHandshakeAsResponder,
  answerProbe,
  DEFAULT_HANDSHAKE_CONFIG,
  buildProberSystemPrompt,
} from "../../src/handshake.js";
import type { GuardianClient, TrustManifest, PeerRecord } from "../../src/types.js";

const MANIFEST: TrustManifest = {
  slug: "joe",
  raw: "## Who I am\n\nJoe.\n",
  identityBlurb: "Joe.",
  hardNos: [],
  counterOfferRules: [],
  driftPolicy: "",
  otherSections: {},
};

const PEER: PeerRecord = {
  slug: "chad",
  knownSince: "2024-12-01T00:00:00Z",
  lastSeen: "2026-04-25T00:00:00Z",
  vouchedBy: ["mom"],
  trustScore: 0.7,
  strikes: 0,
  notes: "",
  theirHistorySnapshot: "Chad and Joe drove to a cabin in March 2026.",
};

describe("parseEvaluation", () => {
  it("extracts confidence and reason from canonical format", () => {
    const text = "CONFIDENCE: 0.83\nREASON: They knew the cabin name we discussed.";
    const r = parseEvaluation(text);
    expect(r.confidence).toBeCloseTo(0.83);
    expect(r.reason).toContain("cabin");
  });

  it("clamps confidence to [0,1]", () => {
    expect(parseEvaluation("CONFIDENCE: 1.5\nREASON: x").confidence).toBe(1);
    expect(parseEvaluation("CONFIDENCE: -0.2\nREASON: x").confidence).toBe(0);
  });

  it("falls back to 0.5 when format is missing", () => {
    expect(parseEvaluation("garbage").confidence).toBe(0.5);
  });
});

describe("buildProberSystemPrompt", () => {
  it("includes peer record details when present", () => {
    const sp = buildProberSystemPrompt({
      myManifest: MANIFEST,
      peerRecord: PEER,
      peerClaim: "chad",
    });
    expect(sp).toContain("chad");
    expect(sp).toContain("vouched by: mom");
    expect(sp).toContain("trust score: 0.70");
    expect(sp).toContain("Chad and Joe drove to a cabin");
  });

  it("notes first contact when no peer record", () => {
    const sp = buildProberSystemPrompt({
      myManifest: MANIFEST,
      peerRecord: null,
      peerClaim: "stranger-123",
    });
    expect(sp).toContain("first contact");
    expect(sp).toContain("stranger-123");
  });
});

describe("runHandshakeAsResponder (mocked)", () => {
  it("passes when answers are scored high", async () => {
    let callCount = 0;
    const guardian: GuardianClient = {
      cost: 0,
      ask: async (system, _user) => {
        callCount++;
        // Alternate: probe text, evaluation. Probe is odd-numbered calls, eval is even.
        if (system.includes("Score it") || system.includes("how confident")) {
          return "CONFIDENCE: 0.95\nREASON: knew specifics no impostor would.";
        }
        // Otherwise it's a probe-generation prompt.
        return `What was the name of the trail we hiked?`;
      },
    };

    const result = await runHandshakeAsResponder({
      config: { ...DEFAULT_HANDSHAKE_CONFIG, probesPerRound: 1 },
      guardian,
      myManifest: MANIFEST,
      peerRecord: PEER,
      peerClaim: "chad",
      exchange: async (_probe) => "Lookout Trail.",
    });

    expect(result.passed).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
    expect(result.trajectory.length).toBeGreaterThan(0);
    expect(callCount).toBeGreaterThanOrEqual(2); // at least one probe + one eval
  });

  it("aborts early when confidence collapses", async () => {
    const guardian: GuardianClient = {
      cost: 0,
      ask: async (system) => {
        if (system.includes("Score it") || system.includes("how confident")) {
          return "CONFIDENCE: 0.05\nREASON: answer was generic and wrong.";
        }
        return "What was the name of the trail?";
      },
    };

    const result = await runHandshakeAsResponder({
      config: { ...DEFAULT_HANDSHAKE_CONFIG, abortThreshold: 0.3 },
      guardian,
      myManifest: MANIFEST,
      peerRecord: PEER,
      peerClaim: "impostor",
      exchange: async () => "I don't remember.",
    });

    expect(result.passed).toBe(false);
    expect(result.confidence).toBeLessThan(0.3);
  });

  it("times out as inconclusive after maxRounds with mid-confidence", async () => {
    const guardian: GuardianClient = {
      cost: 0,
      ask: async (system) => {
        if (system.includes("Score it") || system.includes("how confident")) {
          return "CONFIDENCE: 0.5\nREASON: ambiguous answer.";
        }
        return "Probe?";
      },
    };

    const result = await runHandshakeAsResponder({
      config: { ...DEFAULT_HANDSHAKE_CONFIG, maxRounds: 2 },
      guardian,
      myManifest: MANIFEST,
      peerRecord: PEER,
      peerClaim: "chad",
      exchange: async () => "Maybe.",
    });

    expect(result.passed).toBe(false);
    expect(result.rounds).toBe(2);
    expect(result.reason).toContain("inconclusive");
  });

  it("propagates exchange errors as failed handshake", async () => {
    const guardian: GuardianClient = {
      cost: 0,
      ask: async () => "Probe?",
    };

    const result = await runHandshakeAsResponder({
      config: DEFAULT_HANDSHAKE_CONFIG,
      guardian,
      myManifest: MANIFEST,
      peerRecord: null,
      peerClaim: "ghost",
      exchange: async () => {
        throw new Error("connection refused");
      },
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("connection refused");
  });
});

describe("answerProbe (mocked)", () => {
  it("calls the guardian with the probe and returns the answer", async () => {
    let captured = "";
    const guardian: GuardianClient = {
      cost: 0,
      ask: async (_system, user) => {
        captured = user;
        return "Lookout Trail.";
      },
    };
    const ans = await answerProbe({
      guardian,
      myManifest: MANIFEST,
      peerClaim: "joe",
      probe: "What was the name of the trail?",
    });
    expect(ans).toBe("Lookout Trail.");
    expect(captured).toContain("name of the trail");
  });
});
