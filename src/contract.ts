// Contract generation for Phase 3 (GRANT).
//
// After a successful handshake, the responder's guardian writes a prose
// `contract.md` describing what the initiator may do during this session.
// The initiator's guardian reads it and either acknowledges or closes.
//
// This file is orchestration only — the LLM is injected so we can test the
// shape of the contract without spending API tokens.

import type {
  GuardianClient,
  SessionContract,
  TrustManifest,
} from "./types.js";
import { randomUUID } from "node:crypto";

/**
 * Build the system prompt for contract generation.
 *
 * Marked exports for tests; in production this is called from generateContract.
 */
export function buildContractSystemPrompt(manifest: TrustManifest): string {
  return [
    "You are the guardian for an inspectable-trust persona.",
    `Your owner's slug: ${manifest.slug}.`,
    "",
    "Your job in this turn: write a short prose CONTRACT for a session that just",
    "passed the identity handshake. The contract is what the initiator may do",
    "during the session, in plain English.",
    "",
    "Your owner's trust manifest is below. Honor it. Lean conservative on first",
    "contact; you can be more permissive on follow-up sessions.",
    "",
    "----- TRUST MANIFEST BEGIN -----",
    manifest.raw,
    "----- TRUST MANIFEST END -----",
    "",
    "Output the contract as STRICT MARKDOWN, with these required sections in order:",
    "  ## Scope",
    "  ## Hard Nos",
    "  ## Counter-Offers",
    "Each section is 1-5 short bullets or sentences. Keep it under 300 words total.",
    "Do not output anything else.",
  ].join("\n");
}

/**
 * Build the user message for contract generation: the initiator's stated intent
 * and their slug.
 */
export function buildContractUserMessage(opts: {
  initiatorSlug: string;
  intent: string;
  handshakeNotes?: string;
}): string {
  const lines = [
    `Initiator slug: ${opts.initiatorSlug}`,
    "",
    "Initiator's stated intent:",
    `  > ${opts.intent.replace(/\n/g, "\n  > ")}`,
  ];
  if (opts.handshakeNotes) {
    lines.push("", "Handshake notes:", `  ${opts.handshakeNotes}`);
  }
  lines.push("", "Now write the contract.");
  return lines.join("\n");
}

/**
 * Parse a contract markdown blob into a structured SessionContract.
 * Tolerant of section header variants and surrounding chatter.
 */
export function parseContractMarkdown(
  markdown: string,
  meta: { sessionId: string; initiator: string; responder: string },
): SessionContract {
  const sections = splitH2(markdown);
  const scope = pick(sections, ["scope"]);
  const hardNos = bullets(pick(sections, ["hard nos", "hard-nos", "off-limits"]));
  const counterOffers = bullets(
    pick(sections, ["counter-offers", "counter offers", "transforms"]),
  );

  return {
    sessionId: meta.sessionId,
    written: new Date().toISOString(),
    initiator: meta.initiator,
    responder: meta.responder,
    scope,
    hardNos,
    counterOffers,
  };
}

/**
 * High-level: have the responder's guardian write the contract for an incoming
 * session. Returns both the parsed contract and the raw markdown (so we can
 * archive it on disk).
 */
export async function generateContract(opts: {
  guardian: GuardianClient;
  responderManifest: TrustManifest;
  initiatorSlug: string;
  intent: string;
  handshakeNotes?: string;
  sessionId?: string;
}): Promise<{ contract: SessionContract; raw: string }> {
  const sessionId = opts.sessionId ?? randomUUID();
  const system = buildContractSystemPrompt(opts.responderManifest);
  const user = buildContractUserMessage({
    initiatorSlug: opts.initiatorSlug,
    intent: opts.intent,
    handshakeNotes: opts.handshakeNotes,
  });
  const raw = await opts.guardian.ask(system, user);
  const contract = parseContractMarkdown(raw, {
    sessionId,
    initiator: opts.initiatorSlug,
    responder: opts.responderManifest.slug,
  });
  return { contract, raw };
}

// --- helpers ---

function splitH2(markdown: string): Record<string, string> {
  const lines = markdown.split("\n");
  const out: Record<string, string> = {};
  let cur = "_preamble";
  let buf: string[] = [];
  const flush = () => {
    out[cur] = buf.join("\n").trim();
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      cur = m[1]!.trim().toLowerCase();
      buf = [];
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

function pick(sections: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    const v = sections[c.toLowerCase()];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function bullets(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const item = buf.join(" ").replace(/\s+/g, " ").trim();
    if (item) out.push(item);
    buf = [];
  };
  for (const line of text.split("\n")) {
    const m = line.match(/^[\s]*[-*]\s+(.*)$/);
    if (m) {
      flush();
      buf.push(m[1]!);
    } else if (line.trim() === "") {
      flush();
    } else if (buf.length > 0) {
      buf.push(line.trim());
    }
  }
  flush();
  return out;
}
