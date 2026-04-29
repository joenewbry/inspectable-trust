// peers/<slug>/ folder operations.
//
// Each peer we've ever talked to has a folder. Inside is everything we know
// about them: when we first met, when we last saw them, who introduced them
// (vouch chain), an optional snapshot of their published trust.md, an
// optional snapshot of their history.log they shared with us, and a small
// trust score we update over time.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PeerRecord } from "./types.js";

function peerDir(trustDir: string, slug: string): string {
  return join(trustDir, "peers", slug);
}

/** Load a peer record. Returns null if we've never met them. */
export function loadPeer(trustDir: string, slug: string): PeerRecord | null {
  const dir = peerDir(trustDir, slug);
  if (!existsSync(dir)) return null;

  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as {
    knownSince: string;
    lastSeen: string;
    vouchedBy: string[];
    trustScore: number;
    strikes: number;
    notes: string;
  };

  const theirTrustMd = readIfExists(join(dir, "their-trust.md"));
  const theirHistorySnapshot = readIfExists(join(dir, "their-history-snapshot.log"));

  return {
    slug,
    knownSince: meta.knownSince,
    lastSeen: meta.lastSeen,
    vouchedBy: meta.vouchedBy ?? [],
    theirTrustMd,
    theirHistorySnapshot,
    trustScore: meta.trustScore ?? 0,
    strikes: meta.strikes ?? 0,
    notes: meta.notes ?? "",
  };
}

/** Persist a peer record. Creates the folder if needed. */
export function savePeer(trustDir: string, peer: PeerRecord): void {
  const dir = peerDir(trustDir, peer.slug);
  mkdirSync(dir, { recursive: true });

  const meta = {
    knownSince: peer.knownSince,
    lastSeen: peer.lastSeen,
    vouchedBy: peer.vouchedBy,
    trustScore: peer.trustScore,
    strikes: peer.strikes,
    notes: peer.notes,
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

  if (peer.theirTrustMd !== undefined) {
    writeFileSync(join(dir, "their-trust.md"), peer.theirTrustMd, "utf8");
  }
  if (peer.theirHistorySnapshot !== undefined) {
    writeFileSync(join(dir, "their-history-snapshot.log"), peer.theirHistorySnapshot, "utf8");
  }
}

/** Create a fresh peer record. Default trust=0, no strikes. */
export function newPeer(slug: string, vouchedBy: string[] = []): PeerRecord {
  const now = new Date().toISOString();
  return {
    slug,
    knownSince: now,
    lastSeen: now,
    vouchedBy,
    trustScore: 0,
    strikes: 0,
    notes: "",
  };
}

/** Update lastSeen + bump trust score after a successful interaction. */
export function recordSuccessfulInteraction(
  trustDir: string,
  slug: string,
  delta = 0.05,
): void {
  let peer = loadPeer(trustDir, slug);
  if (!peer) {
    peer = newPeer(slug);
  }
  peer.lastSeen = new Date().toISOString();
  peer.trustScore = Math.min(1, peer.trustScore + delta);
  savePeer(trustDir, peer);
}

/** Add a strike. Strikes decay at 30 days/strike, computed lazily on read. */
export function addStrike(trustDir: string, slug: string, reason: string): void {
  let peer = loadPeer(trustDir, slug);
  if (!peer) {
    peer = newPeer(slug);
  }
  peer.strikes += 1;
  peer.notes = (peer.notes + "\n" + new Date().toISOString() + " strike: " + reason).trim();
  savePeer(trustDir, peer);
}

/** Compute decayed strike count: strikes minus floor((now - knownSince) / 30 days). */
export function effectiveStrikes(peer: PeerRecord): number {
  const ageMs = Date.now() - new Date(peer.knownSince).getTime();
  const decayed = Math.floor(ageMs / (30 * 24 * 60 * 60 * 1000));
  return Math.max(0, peer.strikes - decayed);
}

function readIfExists(path: string): string | undefined {
  if (existsSync(path)) {
    return readFileSync(path, "utf8");
  }
  return undefined;
}
