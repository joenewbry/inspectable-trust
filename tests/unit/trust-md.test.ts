import { describe, it, expect } from "vitest";
import { parseTrustMd } from "../../src/trust-md.js";

const SAMPLE = `# Joe's trust.md

Some preamble text.

## Who I am

Joe Newbry. Brooklyn, NY. Solo founder.

## How I think about tiers

I don't have a fixed list. Tiers are decided per-session.

## What's always off-limits

- Full SSN, full account numbers, full credit card numbers
- My location in real time
- The contents of \`~/personal/\` and \`~/Documents/private/\`
- My partner's data, my kid's data — they have their own trust.md

## Counter-offers I'm willing to make

- Last-4 of any account number instead of the full number
- Category-level totals instead of transaction-level detail
- Medication class ("topical steroid") instead of brand name

## Drift policy

If you start asking for things outside what we agreed:

1. First time: ask why, in good faith.
2. Second time: still answer if it can, but log the drift.
3. Third time: close the session.
`;

describe("parseTrustMd", () => {
  it("extracts the identity blurb", () => {
    const m = parseTrustMd(SAMPLE, "joe");
    expect(m.identityBlurb).toContain("Joe Newbry");
    expect(m.identityBlurb).toContain("Brooklyn");
  });

  it("extracts hard nos as bullet items", () => {
    const m = parseTrustMd(SAMPLE, "joe");
    expect(m.hardNos.length).toBe(4);
    expect(m.hardNos[0]).toContain("Full SSN");
    expect(m.hardNos[1]).toContain("location in real time");
  });

  it("extracts counter-offer rules", () => {
    const m = parseTrustMd(SAMPLE, "joe");
    expect(m.counterOfferRules.length).toBe(3);
    expect(m.counterOfferRules[0]).toContain("Last-4");
  });

  it("captures the drift policy text", () => {
    const m = parseTrustMd(SAMPLE, "joe");
    expect(m.driftPolicy).toContain("First time");
    expect(m.driftPolicy).toContain("Third time");
  });

  it("preserves unknown sections in otherSections", () => {
    const m = parseTrustMd(SAMPLE, "joe");
    expect(Object.keys(m.otherSections)).toContain("How I think about tiers");
    expect(m.otherSections["How I think about tiers"]).toContain("per-session");
  });

  it("preserves the raw text verbatim for the LLM", () => {
    const m = parseTrustMd(SAMPLE, "joe");
    expect(m.raw).toBe(SAMPLE);
  });

  it("uses the supplied slug", () => {
    const m = parseTrustMd(SAMPLE, "stanford-healthcare");
    expect(m.slug).toBe("stanford-healthcare");
  });

  it("tolerates missing sections without throwing", () => {
    const m = parseTrustMd("# Sparse\n\n## Who I am\n\nNobody.\n", "x");
    expect(m.identityBlurb).toBe("Nobody.");
    expect(m.hardNos).toEqual([]);
    expect(m.counterOfferRules).toEqual([]);
    expect(m.driftPolicy).toBe("");
  });

  it("handles multi-line bullets that wrap", () => {
    const m = parseTrustMd(
      `## What's always off-limits\n\n- A bullet that\n  wraps onto two lines\n- A second bullet\n`,
      "x",
    );
    expect(m.hardNos).toEqual([
      "A bullet that wraps onto two lines",
      "A second bullet",
    ]);
  });
});
