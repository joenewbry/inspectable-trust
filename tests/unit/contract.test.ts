import { describe, it, expect } from "vitest";
import {
  buildContractSystemPrompt,
  buildContractUserMessage,
  parseContractMarkdown,
  generateContract,
} from "../../src/contract.js";
import type { GuardianClient, TrustManifest } from "../../src/types.js";

const MANIFEST: TrustManifest = {
  slug: "stanford-healthcare",
  raw: "## Who I am\n\nStanford Healthcare's record vault.\n",
  identityBlurb: "Stanford Healthcare's record vault.",
  hardNos: ["psych notes never leave the chart"],
  counterOfferRules: ["category instead of brand name"],
  driftPolicy: "soft challenge then close",
  otherSections: {},
};

describe("system + user prompt builders", () => {
  it("includes the slug and the raw manifest in system prompt", () => {
    const sp = buildContractSystemPrompt(MANIFEST);
    expect(sp).toContain("stanford-healthcare");
    expect(sp).toContain("Stanford Healthcare's record vault");
    expect(sp).toContain("Scope");
    expect(sp).toContain("Hard Nos");
    expect(sp).toContain("Counter-Offers");
  });

  it("user message contains the initiator and intent", () => {
    const um = buildContractUserMessage({
      initiatorSlug: "joe",
      intent: "I'm doing tax prep, need 1099-SA totals",
      handshakeNotes: "passed in 2 rounds, confidence 0.88",
    });
    expect(um).toContain("joe");
    expect(um).toContain("tax prep");
    expect(um).toContain("0.88");
  });
});

describe("parseContractMarkdown", () => {
  it("parses a well-formed contract", () => {
    const md = `## Scope

You may read 1099-SA forms for tax year 2025. Account numbers will be returned as last-4 only.

## Hard Nos

- Diagnosis-specific notes
- Doctor's free-text notes

## Counter-Offers

- Total HSA distribution amount instead of itemized
- Date range only, no specific dates
`;
    const c = parseContractMarkdown(md, {
      sessionId: "s1",
      initiator: "joe",
      responder: "stanford-healthcare",
    });
    expect(c.scope).toContain("1099-SA forms");
    expect(c.hardNos).toEqual([
      "Diagnosis-specific notes",
      "Doctor's free-text notes",
    ]);
    expect(c.counterOffers.length).toBe(2);
    expect(c.sessionId).toBe("s1");
    expect(c.initiator).toBe("joe");
    expect(c.responder).toBe("stanford-healthcare");
  });

  it("tolerates extra whitespace and missing sections", () => {
    const md = `## Scope\n\nSomething.\n`;
    const c = parseContractMarkdown(md, {
      sessionId: "s1",
      initiator: "a",
      responder: "b",
    });
    expect(c.scope).toBe("Something.");
    expect(c.hardNos).toEqual([]);
    expect(c.counterOffers).toEqual([]);
  });
});

describe("generateContract (with mocked LLM)", () => {
  it("calls the guardian and returns a parsed contract", async () => {
    const calls: { system: string; user: string }[] = [];
    const guardian: GuardianClient = {
      cost: 0,
      ask: async (system, user) => {
        calls.push({ system, user });
        return `## Scope\n\nRead-only access to tax-relevant records for 2025.\n\n## Hard Nos\n\n- Mental health records\n\n## Counter-Offers\n\n- Aggregated totals only\n`;
      },
    };
    const result = await generateContract({
      guardian,
      responderManifest: MANIFEST,
      initiatorSlug: "joe",
      intent: "tax prep",
      sessionId: "fixed-session-id",
    });

    expect(calls.length).toBe(1);
    expect(calls[0]!.system).toContain("stanford-healthcare");
    expect(calls[0]!.user).toContain("tax prep");
    expect(result.contract.sessionId).toBe("fixed-session-id");
    expect(result.contract.scope).toContain("Read-only access");
    expect(result.contract.hardNos).toEqual(["Mental health records"]);
    expect(result.contract.counterOffers).toEqual(["Aggregated totals only"]);
    expect(result.raw).toContain("## Scope");
  });
});
