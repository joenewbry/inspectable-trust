// Parse a trust.md file into a TrustManifest.
//
// trust.md is INTENDED to stay as prose. We don't try to extract a permission
// matrix — the guardian LLM does that contextually. We only parse out a few
// landmark sections so that:
//   - the OPEN frame can show "who I am" in the wire dialogue
//   - hard-nos can short-circuit before any LLM call where the violation is obvious
//   - counter-offer rules and drift policy are surfaced into the contract

import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { TrustManifest } from "./types.js";

/**
 * Read and parse a trust.md from disk. The slug comes from the parent of .trust/.
 */
export function loadManifest(trustDir: string): TrustManifest {
  // trustDir is e.g. /Users/joe/.trust — parent is /Users/joe → slug "joe"
  const identityDir = dirname(trustDir);
  const folderName = basename(identityDir);
  const slug = folderName.startsWith(".") || folderName === "" ? "self" : folderName;
  const raw = readFileSync(`${trustDir}/trust.md`, "utf8");
  return parseTrustMd(raw, slug);
}

/** Parse the text of a trust.md into a TrustManifest. */
export function parseTrustMd(raw: string, slug: string): TrustManifest {
  const sections = splitSections(raw);

  const identityBlurb = pickFirstNonEmpty(sections, [
    "who i am",
    "identity",
    "about me",
  ]);

  const hardNosText = pickFirstNonEmpty(sections, [
    "what's always off-limits",
    "hard nos",
    "hard-nos",
    "never share",
  ]);
  const hardNos = extractBullets(hardNosText);

  const counterOffersText = pickFirstNonEmpty(sections, [
    "counter-offers i'm willing to make",
    "counter-offers",
    "transforms",
  ]);
  const counterOfferRules = extractBullets(counterOffersText);

  const driftPolicy = pickFirstNonEmpty(sections, [
    "drift policy",
    "drift",
    "if you drift",
  ]);

  // Anything else is preserved as raw section text.
  const known = new Set(
    [
      "who i am",
      "identity",
      "about me",
      "what's always off-limits",
      "hard nos",
      "hard-nos",
      "never share",
      "counter-offers i'm willing to make",
      "counter-offers",
      "transforms",
      "drift policy",
      "drift",
      "if you drift",
    ].map((s) => s.toLowerCase()),
  );
  const otherSections: Record<string, string> = {};
  for (const [heading, body] of Object.entries(sections)) {
    if (!known.has(heading.toLowerCase())) {
      otherSections[heading] = body;
    }
  }

  return {
    slug,
    raw,
    identityBlurb,
    hardNos,
    counterOfferRules,
    driftPolicy,
    otherSections,
  };
}

/**
 * Split the markdown into sections keyed by H2 heading.
 * Anything before the first H2 goes under "_preamble".
 */
function splitSections(raw: string): Record<string, string> {
  const lines = raw.split("\n");
  const sections: Record<string, string> = {};
  let currentHeading = "_preamble";
  let buffer: string[] = [];

  const flush = () => {
    sections[currentHeading] = buffer.join("\n").trim();
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      flush();
      currentHeading = h2[1]!.trim();
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

/** Find the first non-empty section among a set of likely heading variants. */
function pickFirstNonEmpty(
  sections: Record<string, string>,
  candidates: string[],
): string {
  const lowerToOrig: Record<string, string> = {};
  for (const k of Object.keys(sections)) {
    lowerToOrig[k.toLowerCase()] = k;
  }
  for (const c of candidates) {
    const orig = lowerToOrig[c.toLowerCase()];
    if (orig && sections[orig] && sections[orig].trim()) {
      return sections[orig].trim();
    }
  }
  return "";
}

/** Pull bullet items out of a markdown blob. Both - and * are accepted. Multi-line bullets join until the next bullet. */
function extractBullets(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  const out: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    const item = buf.join(" ").replace(/\s+/g, " ").trim();
    if (item) out.push(item);
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^[\s]*[-*]\s+(.*)$/);
    if (m) {
      flush();
      buf.push(m[1]!);
    } else if (line.trim() === "") {
      flush();
    } else if (buf.length > 0) {
      // Continuation of the previous bullet.
      buf.push(line.trim());
    }
  }
  flush();
  return out;
}
