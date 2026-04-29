// Append-only history log + daily ratchet hashing.
//
// Format: one JSON object per line (JSONL). Each day's last entry is a
// "ratchet" entry that commits sha256(prevRatchet + sha256(today's entries)).
// This makes a stolen snapshot detectably stale: if today's ratchet doesn't
// chain back to yesterday's, the snapshot was forked.
//
// We keep all the data plain text on purpose. A human can `cat history.log`
// and read it. The ratchet adds tamper-evidence without locking it up.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { HistoryEntry, RatchetEntry } from "./types.js";

/** Append a single entry to the history.log under the given .trust/ folder. */
export function appendEntry(trustDir: string, entry: HistoryEntry): void {
  const path = join(trustDir, "history.log");
  const line = JSON.stringify(entry) + "\n";
  appendFileSync(path, line, "utf8");
}

/** Return all entries in order. Skips ratchet entries unless `includeRatchets` is true. */
export function readEntries(
  trustDir: string,
  includeRatchets = false,
): (HistoryEntry | RatchetEntry)[] {
  const path = join(trustDir, "history.log");
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  const out: (HistoryEntry | RatchetEntry)[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.ratchet && !includeRatchets) continue;
      out.push(obj);
    } catch {
      // Skip malformed lines; we never want a parse error to crash a daemon
      // that's otherwise functioning.
    }
  }
  return out;
}

/**
 * Compute and append a daily ratchet entry for `date` (YYYY-MM-DD), based on
 * all non-ratchet entries from that date plus the previous day's ratchet hash.
 *
 * Idempotent: if a ratchet for `date` already exists, returns it unchanged.
 */
export function dailyRatchet(trustDir: string, date: string): RatchetEntry {
  const all = readEntries(trustDir, true);
  const existing = all.find(
    (e): e is RatchetEntry => "ratchet" in e && e.ratchet === true && e.date === date,
  );
  if (existing) return existing;

  // Find the previous day's ratchet to chain from.
  const prior = all
    .filter((e): e is RatchetEntry => "ratchet" in e && e.ratchet === true && e.date < date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const prevHash = prior.length > 0 ? prior[prior.length - 1]!.combinedHash : "GENESIS";

  // Hash today's entries (excluding any ratchet for this same day, which there isn't).
  const todayEntries = all.filter(
    (e): e is HistoryEntry => !("ratchet" in e) && (e as HistoryEntry).ts.startsWith(date),
  );
  const todayBlob = todayEntries.map((e) => JSON.stringify(e)).join("\n");
  const dayHash = sha256(todayBlob);
  const combinedHash = sha256(prevHash + dayHash);

  const entry: RatchetEntry = {
    ts: `${date}T23:59:59Z`,
    ratchet: true,
    date,
    prevHash,
    dayHash,
    combinedHash,
  };

  appendFileSync(join(trustDir, "history.log"), JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

/**
 * Verify the ratchet chain. Returns null if intact, or a string describing
 * the break (e.g. "ratchet for 2026-04-26 doesn't chain to 2026-04-25").
 */
export function verifyChain(trustDir: string): string | null {
  const all = readEntries(trustDir, true);
  const ratchets = all
    .filter((e): e is RatchetEntry => "ratchet" in e && e.ratchet === true)
    .sort((a, b) => a.date.localeCompare(b.date));

  let expectedPrev = "GENESIS";
  for (const r of ratchets) {
    if (r.prevHash !== expectedPrev) {
      return `ratchet for ${r.date} expected prevHash=${expectedPrev.slice(0, 12)}... but got ${r.prevHash.slice(0, 12)}...`;
    }
    // Recompute combined to check internal integrity.
    const combined = sha256(r.prevHash + r.dayHash);
    if (combined !== r.combinedHash) {
      return `ratchet for ${r.date} has corrupted combinedHash`;
    }
    expectedPrev = r.combinedHash;
  }
  return null;
}

/** Initialize a fresh history.log if none exists. */
export function ensureLog(trustDir: string): void {
  const path = join(trustDir, "history.log");
  if (!existsSync(path)) {
    writeFileSync(path, "", "utf8");
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
