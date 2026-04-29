import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPeer,
  savePeer,
  newPeer,
  recordSuccessfulInteraction,
  addStrike,
  effectiveStrikes,
} from "../../src/peers.js";

let trustDir: string;

beforeEach(() => {
  trustDir = mkdtempSync(join(tmpdir(), "trust-peers-test-"));
});

afterEach(() => {
  rmSync(trustDir, { recursive: true, force: true });
});

describe("save/load round-trip", () => {
  it("persists and reads back a peer record", () => {
    const peer = newPeer("chad", ["mom"]);
    peer.theirTrustMd = "## Who I am\n\nChad.\n";
    peer.theirHistorySnapshot = "some history\nsome more\n";
    peer.notes = "good guy";
    savePeer(trustDir, peer);

    const loaded = loadPeer(trustDir, "chad");
    expect(loaded).not.toBeNull();
    expect(loaded!.slug).toBe("chad");
    expect(loaded!.vouchedBy).toEqual(["mom"]);
    expect(loaded!.theirTrustMd).toBe(peer.theirTrustMd);
    expect(loaded!.theirHistorySnapshot).toBe(peer.theirHistorySnapshot);
    expect(loaded!.notes).toBe("good guy");
    expect(loaded!.trustScore).toBe(0);
    expect(loaded!.strikes).toBe(0);
  });

  it("returns null for unknown peer", () => {
    expect(loadPeer(trustDir, "nobody")).toBeNull();
  });

  it("creates the peers directory tree on save", () => {
    const peer = newPeer("alice");
    savePeer(trustDir, peer);
    expect(existsSync(join(trustDir, "peers", "alice", "meta.json"))).toBe(true);
  });
});

describe("recordSuccessfulInteraction", () => {
  it("creates a peer if one doesn't exist and bumps trust", () => {
    recordSuccessfulInteraction(trustDir, "alice", 0.1);
    const p = loadPeer(trustDir, "alice");
    expect(p).not.toBeNull();
    expect(p!.trustScore).toBeCloseTo(0.1);
  });

  it("clamps trust at 1.0", () => {
    for (let i = 0; i < 30; i++) {
      recordSuccessfulInteraction(trustDir, "alice", 0.1);
    }
    const p = loadPeer(trustDir, "alice");
    expect(p!.trustScore).toBe(1);
  });
});

describe("addStrike", () => {
  it("adds a strike with reason in notes", () => {
    addStrike(trustDir, "alice", "asked for SSN");
    const p = loadPeer(trustDir, "alice");
    expect(p!.strikes).toBe(1);
    expect(p!.notes).toContain("asked for SSN");
  });

  it("accumulates strikes", () => {
    addStrike(trustDir, "alice", "first");
    addStrike(trustDir, "alice", "second");
    expect(loadPeer(trustDir, "alice")!.strikes).toBe(2);
  });
});

describe("effectiveStrikes (decay)", () => {
  it("decays one strike per 30 days", () => {
    const peer = newPeer("old-peer");
    peer.strikes = 5;
    peer.knownSince = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
    expect(effectiveStrikes(peer)).toBe(3); // 5 - 2 (60/30) = 3
  });

  it("never goes negative", () => {
    const peer = newPeer("very-old");
    peer.strikes = 1;
    peer.knownSince = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year
    expect(effectiveStrikes(peer)).toBe(0);
  });

  it("returns full strikes when peer is new", () => {
    const peer = newPeer("new-peer");
    peer.strikes = 3;
    expect(effectiveStrikes(peer)).toBe(3);
  });
});
