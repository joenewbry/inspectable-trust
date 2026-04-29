// Shared types for the inspectable-trust protocol.
//
// Everything is designed to be readable by both humans and LLMs.
// Most "structured data" is actually prose; we parse only enough to route.

/** A parsed trust.md file. Most content stays as prose for the LLM to reason over. */
export interface TrustManifest {
  /** Slug derived from the .trust/ folder's parent dir name. e.g. "joe", "stanford-healthcare". */
  slug: string;
  /** The full raw trust.md text — passed verbatim to the guardian LLM as system prompt material. */
  raw: string;
  /** "Who I am" section, parsed out so we can show it in the OPEN frame. */
  identityBlurb: string;
  /** Hard-no rules — the guardian short-circuits on these without an LLM call where possible. */
  hardNos: string[];
  /** Examples of pre-authorized counter-offer transforms. The LLM may add ad-hoc ones. */
  counterOfferRules: string[];
  /** Drift policy text. */
  driftPolicy: string;
  /** Any sections we didn't understand — preserved as raw text for the LLM. */
  otherSections: Record<string, string>;
}

/** A single line on the wire. The whole protocol is just this, going back and forth. */
export interface WireMessage {
  /** Plain English about intent. 1-2 sentences. The "why". */
  frame: string;
  /** Either the executable command (outbound) or the response payload (inbound). */
  body: string;
  /** "command" for outbound (initiator → responder), "response" for inbound. */
  bodyKind: "command" | "response";
}

/** A history.log entry. Append-only. */
export interface HistoryEntry {
  /** ISO timestamp. */
  ts: string;
  /** Session UUID this entry belongs to. */
  sessionId: string;
  /** "in" = received from peer, "out" = sent to peer, "internal" = guardian decision/log. */
  dir: "in" | "out" | "internal";
  /** Peer slug, or "self" for internal entries. */
  peer: string;
  /** Phase: open|handshake|grant|work|close. */
  phase: SessionPhase;
  /** Plain-English summary of what happened on this turn. */
  frame: string;
  /** The command, response, or internal note text. */
  body: string;
  /** Decision tag for filtered review. */
  decision?: "allow" | "deny" | "counter-offer" | "drift-challenge" | "drift-warn" | "terminate";
  /** Optional rule citation, e.g. "trust.md:hard-nos:full-ssn". */
  ruleCited?: string;
}

/** A daily ratchet hash, written as the last line of each day's slice in history.log. */
export interface RatchetEntry {
  ts: string;
  ratchet: true;
  date: string;          // YYYY-MM-DD
  prevHash: string;       // hash of yesterday's ratchet entry, or "GENESIS"
  dayHash: string;        // sha256 of today's entries (excluding the ratchet itself)
  combinedHash: string;   // sha256(prevHash + dayHash)
}

export type SessionPhase = "open" | "handshake" | "grant" | "work" | "close";

/** A peer's cached info on disk. */
export interface PeerRecord {
  slug: string;
  knownSince: string;     // ISO timestamp
  lastSeen: string;       // ISO timestamp
  vouchedBy: string[];    // other peer slugs that introduced this peer
  /** Optional: the peer's published trust.md (their public face). */
  theirTrustMd?: string;
  /** Optional: a snapshot of the peer's history.log they shared with us. */
  theirHistorySnapshot?: string;
  /** Confidence we've built up about this peer over time. 0-1. */
  trustScore: number;
  /** Strikes accumulated; decays at 30 days/strike. */
  strikes: number;
  /** Notes for this peer, free text. */
  notes: string;
}

/** Result of a P2 handshake. */
export interface HandshakeResult {
  passed: boolean;
  confidence: number;
  rounds: number;
  /** Confidence per round, for plotting. */
  trajectory: number[];
  reason: string;
}

/** A per-session contract written by the responder's guardian during P3. */
export interface SessionContract {
  sessionId: string;
  /** ISO timestamp when written. */
  written: string;
  /** Initiator slug. */
  initiator: string;
  /** Responder slug. */
  responder: string;
  /** The prose contract — what initiator may do this session. */
  scope: string;
  /** Specific hard-nos for this session (often a subset of trust.md hard-nos plus context-specific ones). */
  hardNos: string[];
  /** Counter-offer transforms the responder is pre-authorizing. */
  counterOffers: string[];
}

/** A judgment from the guardian during P4 (work loop). */
export interface CommandJudgment {
  decision: "allow" | "deny" | "counter-offer";
  /** When allow: the response body to send back. */
  response?: string;
  /** When counter-offer: the alternative response. May be multi-option. */
  counterOffer?: string;
  /** When deny: the reason in plain English. */
  denyReason?: string;
  /** True iff this command was outside the contract's scope (any decision). */
  drifted: boolean;
  /** Optional rule citation. */
  ruleCited?: string;
}

/** Convenience interface for guardian LLM, injectable so tests can mock. */
export interface GuardianClient {
  /** Run an LLM call. systemPrompt is cacheable; userMessage is the per-turn input. */
  ask(systemPrompt: string, userMessage: string): Promise<string>;
  /** Total cost spent on this client instance, in USD. */
  cost: number;
}
