import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEntry,
  readEntries,
  dailyRatchet,
  verifyChain,
  ensureLog,
} from "../../src/history.js";

let trustDir: string;

beforeEach(() => {
  trustDir = mkdtempSync(join(tmpdir(), "trust-history-test-"));
  ensureLog(trustDir);
});

afterEach(() => {
  rmSync(trustDir, { recursive: true, force: true });
});

describe("appendEntry / readEntries", () => {
  it("appends entries and reads them back in order", () => {
    appendEntry(trustDir, {
      ts: "2026-04-28T09:00:00Z",
      sessionId: "s1",
      dir: "out",
      peer: "stanford-healthcare",
      phase: "open",
      frame: "opening",
      body: "hi",
    });
    appendEntry(trustDir, {
      ts: "2026-04-28T09:00:01Z",
      sessionId: "s1",
      dir: "in",
      peer: "stanford-healthcare",
      phase: "open",
      frame: "ack",
      body: "hi back",
    });

    const entries = readEntries(trustDir);
    expect(entries.length).toBe(2);
    expect((entries[0] as any).body).toBe("hi");
    expect((entries[1] as any).body).toBe("hi back");
  });

  it("returns empty array for a fresh log", () => {
    expect(readEntries(trustDir)).toEqual([]);
  });

  it("skips ratchet entries by default but includes them with includeRatchets", () => {
    appendEntry(trustDir, {
      ts: "2026-04-28T09:00:00Z",
      sessionId: "s1",
      dir: "out",
      peer: "stanford-healthcare",
      phase: "open",
      frame: "x",
      body: "y",
    });
    dailyRatchet(trustDir, "2026-04-28");
    expect(readEntries(trustDir).length).toBe(1);
    expect(readEntries(trustDir, true).length).toBe(2);
  });

  it("tolerates malformed lines without throwing", () => {
    const path = join(trustDir, "history.log");
    appendFileSync(path, "this is not json\n", "utf8");
    appendEntry(trustDir, {
      ts: "2026-04-28T09:00:00Z",
      sessionId: "s1",
      dir: "out",
      peer: "p",
      phase: "open",
      frame: "x",
      body: "y",
    });
    expect(readEntries(trustDir).length).toBe(1);
  });
});

describe("dailyRatchet", () => {
  it("creates a GENESIS-rooted ratchet for the first day", () => {
    appendEntry(trustDir, {
      ts: "2026-04-28T09:00:00Z",
      sessionId: "s1",
      dir: "out",
      peer: "p",
      phase: "open",
      frame: "x",
      body: "y",
    });
    const r = dailyRatchet(trustDir, "2026-04-28");
    expect(r.prevHash).toBe("GENESIS");
    expect(r.dayHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.combinedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.date).toBe("2026-04-28");
  });

  it("chains the second day's ratchet to the first", () => {
    appendEntry(trustDir, {
      ts: "2026-04-28T09:00:00Z",
      sessionId: "s1",
      dir: "out",
      peer: "p",
      phase: "open",
      frame: "x",
      body: "y",
    });
    const r1 = dailyRatchet(trustDir, "2026-04-28");

    appendEntry(trustDir, {
      ts: "2026-04-29T09:00:00Z",
      sessionId: "s2",
      dir: "out",
      peer: "p",
      phase: "open",
      frame: "x",
      body: "z",
    });
    const r2 = dailyRatchet(trustDir, "2026-04-29");

    expect(r2.prevHash).toBe(r1.combinedHash);
  });

  it("is idempotent — calling twice returns the same entry", () => {
    appendEntry(trustDir, {
      ts: "2026-04-28T09:00:00Z",
      sessionId: "s1",
      dir: "out",
      peer: "p",
      phase: "open",
      frame: "x",
      body: "y",
    });
    const r1 = dailyRatchet(trustDir, "2026-04-28");
    const r2 = dailyRatchet(trustDir, "2026-04-28");
    expect(r1).toEqual(r2);
    // And we shouldn't have added a duplicate ratchet line.
    const lines = readFileSync(join(trustDir, "history.log"), "utf8")
      .split("\n")
      .filter((l) => l.trim());
    expect(lines.filter((l) => l.includes('"ratchet":true')).length).toBe(1);
  });
});

describe("verifyChain", () => {
  it("returns null on an empty log", () => {
    expect(verifyChain(trustDir)).toBeNull();
  });

  it("returns null on a valid chain", () => {
    appendEntry(trustDir, {
      ts: "2026-04-28T09:00:00Z",
      sessionId: "s1",
      dir: "out",
      peer: "p",
      phase: "open",
      frame: "x",
      body: "y",
    });
    dailyRatchet(trustDir, "2026-04-28");
    appendEntry(trustDir, {
      ts: "2026-04-29T09:00:00Z",
      sessionId: "s2",
      dir: "out",
      peer: "p",
      phase: "open",
      frame: "x",
      body: "z",
    });
    dailyRatchet(trustDir, "2026-04-29");
    expect(verifyChain(trustDir)).toBeNull();
  });

  it("detects a broken chain when an attacker rewrites a ratchet's prevHash", () => {
    appendEntry(trustDir, {
      ts: "2026-04-28T09:00:00Z",
      sessionId: "s1",
      dir: "out",
      peer: "p",
      phase: "open",
      frame: "x",
      body: "y",
    });
    dailyRatchet(trustDir, "2026-04-28");

    // Manually insert a fake day-2 ratchet with wrong prevHash.
    const fake = {
      ts: "2026-04-29T23:59:59Z",
      ratchet: true,
      date: "2026-04-29",
      prevHash: "deadbeef",
      dayHash: "0".repeat(64),
      combinedHash: "0".repeat(64),
    };
    appendFileSync(join(trustDir, "history.log"), JSON.stringify(fake) + "\n", "utf8");

    const err = verifyChain(trustDir);
    expect(err).not.toBeNull();
    expect(err).toMatch(/2026-04-29/);
  });
});
