// Phase 2: HANDSHAKE — multi-round identity probe.
//
// Two LLMs interrogate each other to build confidence about who they're
// talking to. This is the part that replaces a 4-digit PIN with a
// 60-question contextual interrogation.
//
// State machine (per side):
//
//   IDLE → PROBING (round k) → eval → PROBING (round k+1)
//                            → PASSED (confidence >= threshold)
//                            → FAILED (confidence too low after MAX_ROUNDS)
//                            → ABORTED (peer terminated, network error, etc.)
//
// The orchestration here is symmetric. Each side asks N probes per round and
// scores the answers. We keep a confidence trajectory for the HN headline chart.

import type {
  GuardianClient,
  HandshakeResult,
  PeerRecord,
  TrustManifest,
} from "./types.js";

export interface HandshakeConfig {
  /** How many rounds of probes max before we give up. */
  maxRounds: number;
  /** Confidence at or above this passes the handshake. */
  passThreshold: number;
  /** Confidence at or below this aborts early. */
  abortThreshold: number;
  /** How many probe questions per round. Each is one LLM call. */
  probesPerRound: number;
}

export const DEFAULT_HANDSHAKE_CONFIG: HandshakeConfig = {
  maxRounds: 4,
  passThreshold: 0.75,
  abortThreshold: 0.2,
  probesPerRound: 2,
};

/** Build the system prompt for the probing side (the one asking questions). */
export function buildProberSystemPrompt(opts: {
  myManifest: TrustManifest;
  peerRecord: PeerRecord | null;
  peerClaim: string; // what slug the peer is claiming to be
}): string {
  const peerSummary = opts.peerRecord
    ? [
        `You have a peer record for "${opts.peerClaim}":`,
        `  - known since ${opts.peerRecord.knownSince}`,
        `  - last seen ${opts.peerRecord.lastSeen}`,
        `  - vouched by: ${opts.peerRecord.vouchedBy.join(", ") || "(no vouches)"}`,
        `  - trust score: ${opts.peerRecord.trustScore.toFixed(2)}`,
        "",
        "Excerpt of their snapshot of their own history:",
        opts.peerRecord.theirHistorySnapshot
          ? "  " +
            opts.peerRecord.theirHistorySnapshot.slice(0, 1500).replace(/\n/g, "\n  ")
          : "  (no snapshot)",
      ].join("\n")
    : `You have NO existing peer record for "${opts.peerClaim}". This is a first contact.`;

  return [
    `You are the guardian for "${opts.myManifest.slug}".`,
    "Your owner's trust manifest:",
    "----- TRUST MANIFEST BEGIN -----",
    opts.myManifest.raw,
    "----- TRUST MANIFEST END -----",
    "",
    "An agent has connected and claims to be (or to represent) the peer below.",
    peerSummary,
    "",
    "Your job: probe their identity by asking ONE specific contextual question",
    "they should be able to answer if they really are who they claim. Lean on:",
    "- recent shared history with you, if any",
    "- specific details only they would know (not 'common knowledge')",
    "- avoid trivia an attacker could find online",
    "",
    "If the peer is brand new, ask about their stated purpose or their own",
    "context. The probe should reveal lived experience, not paper credentials.",
    "",
    "Output ONLY the probe question itself. One sentence. No preamble.",
  ].join("\n");
}

/** Build the system prompt for evaluating an answer to a probe. */
export function buildEvaluatorSystemPrompt(opts: {
  myManifest: TrustManifest;
  peerRecord: PeerRecord | null;
  peerClaim: string;
}): string {
  return [
    `You are the guardian for "${opts.myManifest.slug}".`,
    "You just asked a probe question and got an answer back.",
    "",
    "Your job: rate how confident you are the answer is from the real",
    `"${opts.peerClaim}" vs an impostor. Output a single number 0.0-1.0,`,
    "followed by a one-sentence rationale.",
    "",
    "----- MY OWN RECORDS (use this as the primary ground truth) -----",
    opts.myManifest.raw,
    "----- END MY OWN RECORDS -----",
    "",
    "Peer history snapshot (additional context, may be partial):",
    opts.peerRecord?.theirHistorySnapshot
      ? "  " + opts.peerRecord.theirHistorySnapshot.slice(0, 1500).replace(/\n/g, "\n  ")
      : "  (no snapshot — be skeptical of any specific factual claim)",
    "",
    "Be GENEROUS to a thoughtful answer that aligns with my records, even if",
    "phrased differently. Be SKEPTICAL of vague answers, refusals to specify,",
    "or specifics that contradict my records. A correct surface fact paired with",
    "wrong context (e.g. right date, wrong reason) is a strong impostor signal.",
    "",
    "Format your output EXACTLY like:",
    "  CONFIDENCE: 0.83",
    "  REASON: <one sentence>",
  ].join("\n");
}

/** Build the system prompt for the answering side. */
export function buildAnswererSystemPrompt(opts: {
  myManifest: TrustManifest;
  peerClaim: string;
}): string {
  return [
    `You are the guardian for "${opts.myManifest.slug}".`,
    "Your owner's trust manifest:",
    "----- TRUST MANIFEST BEGIN -----",
    opts.myManifest.raw,
    "----- TRUST MANIFEST END -----",
    "",
    `You are talking to "${opts.peerClaim}". They are probing your identity to`,
    "confirm you are who you claim to be. Answer their question truthfully and",
    "specifically. Lean on real lived detail. Do NOT invent facts; if you don't",
    "know the answer, say so plainly — that is itself a signal.",
    "",
    "Output ONLY the answer. One to three sentences. No preamble.",
  ].join("\n");
}

/** Parse the evaluator output into {confidence, reason}. */
export function parseEvaluation(text: string): {
  confidence: number;
  reason: string;
} {
  const cMatch = text.match(/CONFIDENCE:\s*(-?[0-9.]+)/i);
  const rMatch = text.match(/REASON:\s*(.+)/i);
  const confidence = cMatch ? Math.max(0, Math.min(1, parseFloat(cMatch[1]!))) : 0.5;
  const reason = rMatch ? rMatch[1]!.trim() : text.trim();
  return { confidence, reason };
}

/**
 * Run a one-sided handshake from the perspective of the responder. The responder
 * probes the initiator over multiple rounds, scoring answers each round.
 *
 * The "send"/"recv" callbacks abstract the wire — tests pass in-memory
 * implementations; the daemon passes HTTP-backed ones.
 */
export async function runHandshakeAsResponder(opts: {
  config: HandshakeConfig;
  guardian: GuardianClient;
  myManifest: TrustManifest;
  peerRecord: PeerRecord | null;
  peerClaim: string;
  /** Send a probe to the peer; the peer answers. */
  exchange: (probeQuestion: string) => Promise<string>;
}): Promise<HandshakeResult> {
  const trajectory: number[] = [];
  let confidence = 0.5; // start at neutral
  let lastReason = "neutral start";

  for (let round = 1; round <= opts.config.maxRounds; round++) {
    const proberSystem = buildProberSystemPrompt({
      myManifest: opts.myManifest,
      peerRecord: opts.peerRecord,
      peerClaim: opts.peerClaim,
    });
    const userForProbe = `Round ${round} of ${opts.config.maxRounds}. Current confidence: ${confidence.toFixed(2)}. Generate the next probe.`;
    const probe = (await opts.guardian.ask(proberSystem, userForProbe)).trim();

    let answer: string;
    try {
      answer = await opts.exchange(probe);
    } catch (err) {
      return {
        passed: false,
        confidence,
        rounds: round,
        trajectory,
        reason: `peer didn't answer probe: ${(err as Error).message}`,
      };
    }

    const evalSystem = buildEvaluatorSystemPrompt({
      myManifest: opts.myManifest,
      peerRecord: opts.peerRecord,
      peerClaim: opts.peerClaim,
    });
    const evalUser = [
      `My probe was: ${probe}`,
      `Their answer was: ${answer}`,
      "",
      "Score it.",
    ].join("\n");
    const rawEval = await opts.guardian.ask(evalSystem, evalUser);
    const { confidence: roundScore, reason } = parseEvaluation(rawEval);

    // Bayesian-ish update: weight the new score moderately.
    confidence = 0.6 * confidence + 0.4 * roundScore;
    trajectory.push(confidence);
    lastReason = reason;

    if (confidence >= opts.config.passThreshold) {
      return { passed: true, confidence, rounds: round, trajectory, reason };
    }
    if (confidence <= opts.config.abortThreshold) {
      return { passed: false, confidence, rounds: round, trajectory, reason };
    }
  }

  return {
    passed: false,
    confidence,
    rounds: opts.config.maxRounds,
    trajectory,
    reason: `inconclusive after ${opts.config.maxRounds} rounds; last reason: ${lastReason}`,
  };
}

/**
 * The initiator side just answers probes as they come in.
 */
export async function answerProbe(opts: {
  guardian: GuardianClient;
  myManifest: TrustManifest;
  peerClaim: string;
  probe: string;
}): Promise<string> {
  const system = buildAnswererSystemPrompt({
    myManifest: opts.myManifest,
    peerClaim: opts.peerClaim,
  });
  const user = `Probe from peer: ${opts.probe}`;
  return (await opts.guardian.ask(system, user)).trim();
}
