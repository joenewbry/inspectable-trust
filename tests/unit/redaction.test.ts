import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { makeStubRedaction } from "../../src/redaction.js";
import { NoCallGuardian } from "../../src/guardian.js";

describe("redaction (stub)", () => {
  let dir: string;
  let aliasesPath: string;

  beforeEach(() => {
    dir = join(tmpdir(), `trust-redaction-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    aliasesPath = join(dir, "aliases.md");
  });

  it("replaces real PII with bracketed synth values on first occurrence", async () => {
    const { redact } = makeStubRedaction();
    const result = await redact("Email: jane@example.com works fine.", {
      aliasesPath,
      sessionId: "test-session",
      turnNumber: 1,
      guardian: new NoCallGuardian(),
    });
    expect(result.redactedBody).toContain("[~");
    expect(result.redactedBody).not.toContain("jane@example.com");
    expect(result.newAliasCount).toBeGreaterThanOrEqual(1);
  });

  it("reuses synthesized values across turns within a session", async () => {
    const { redact } = makeStubRedaction();
    const ctx = (turn: number) => ({
      aliasesPath,
      sessionId: "test-session",
      turnNumber: turn,
      guardian: new NoCallGuardian(),
    });
    const first = await redact("Email Joe Smith now.", ctx(1));
    const newFirst = first.newAliasCount;
    // Same real name in turn 2 — should reuse.
    const second = await redact("Email Joe Smith again.", ctx(2));
    expect(second.newAliasCount).toBe(0);
    expect(second.reusedAliasCount).toBeGreaterThanOrEqual(1);
    // Both responses should have the same synth value for "Joe Smith".
    const synthFirst = first.redactedBody.match(/\[~(.+?)~\]/);
    const synthSecond = second.redactedBody.match(/\[~(.+?)~\]/);
    expect(synthFirst?.[1]).toBeDefined();
    expect(synthFirst?.[1]).toBe(synthSecond?.[1]);
    expect(newFirst).toBeGreaterThanOrEqual(1);
  });

  it("writes aliases.md with header on first append", async () => {
    const { redact } = makeStubRedaction();
    const r = await redact("Find Alice Johnson here.", {
      aliasesPath,
      sessionId: "abc-123",
      turnNumber: 1,
      guardian: new NoCallGuardian(),
    });
    expect(existsSync(aliasesPath)).toBe(true);
    const content = readFileSync(aliasesPath, "utf8");
    expect(content).toMatch(/# Session abc-123 — alias map/);
    expect(content).toMatch(/\| real value \| synthesized value \| first seen \|/);
    // Stub regex captures names as 1 or 2 contiguous capitalized words; we
    // just assert that PII was substituted and rows were written.
    expect(r.newAliasCount).toBeGreaterThanOrEqual(1);
    expect(content).toMatch(/Synth Person/);
  });

  it("aliases.md mode is 0600", async () => {
    const { redact } = makeStubRedaction();
    await redact("Find Alice Johnson here.", {
      aliasesPath,
      sessionId: "abc-123",
      turnNumber: 1,
      guardian: new NoCallGuardian(),
    });
    const { statSync } = await import("node:fs");
    const stat = statSync(aliasesPath);
    // 0o600 in octal = 384 decimal; mask off file-type bits.
    expect(stat.mode & 0o777).toBe(0o600);
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  });
});

// vitest-style afterEach pulled in lazily
import { afterEach } from "vitest";
