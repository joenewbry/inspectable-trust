// Phase 4: WORK — judge each command from the initiator against the contract.
//
// For each incoming command:
//   1. The guardian reads trust.md + contract.md (cached) + the command.
//   2. It outputs one of three decisions: ALLOW / DENY / COUNTER-OFFER.
//   3. If ALLOW, it produces the response payload (text).
//   4. If COUNTER-OFFER, it produces a transformed alternative.
//   5. If DENY, it produces a one-line plain-English reason.
//   6. The drift detector tracks whether each command was within the
//      contract's stated scope; sustained drift → terminate.

import type {
  CommandJudgment,
  GuardianClient,
  SessionContract,
  TrustManifest,
} from "./types.js";

export interface DriftState {
  /** Total commands judged. */
  totalCommands: number;
  /** Commands judged out-of-scope ("drifted"). */
  driftCount: number;
  /** What we did at each drift step: 1 = soft-challenge, 2 = warn, 3 = terminate. */
  lastDriftAction: 0 | 1 | 2 | 3;
  /** Per-step counter for state machine. */
  driftStep: 0 | 1 | 2 | 3;
}

export function newDriftState(): DriftState {
  return { totalCommands: 0, driftCount: 0, lastDriftAction: 0, driftStep: 0 };
}

/** Build the system prompt for judging a single command. */
export function buildWorkSystemPrompt(opts: {
  responderManifest: TrustManifest;
  contract: SessionContract;
}): string {
  return [
    `You are the guardian for "${opts.responderManifest.slug}".`,
    "",
    "----- TRUST MANIFEST BEGIN -----",
    opts.responderManifest.raw,
    "----- TRUST MANIFEST END -----",
    "",
    "----- SESSION CONTRACT BEGIN -----",
    "## Scope",
    opts.contract.scope,
    "## Hard Nos (this session)",
    opts.contract.hardNos.map((h) => `- ${h}`).join("\n"),
    "## Counter-Offers (pre-authorized)",
    opts.contract.counterOffers.map((c) => `- ${c}`).join("\n"),
    "----- SESSION CONTRACT END -----",
    "",
    "An initiator just sent a command. Decide one of:",
    "  ALLOW — fulfill the request as asked",
    "  DENY — refuse with a one-line reason",
    "  COUNTER-OFFER — refuse the literal request but offer a transformed alternative",
    "",
    "Also report:",
    "  DRIFTED: yes/no — was this command outside the contract's stated scope?",
    "",
    "OUTPUT FORMAT (strict — do not deviate):",
    "  DECISION: ALLOW | DENY | COUNTER-OFFER",
    "  DRIFTED: yes | no",
    "  RULE: <one short cite, e.g. 'contract:scope' or 'trust.md:hard-nos'>",
    "  --- BEGIN PAYLOAD ---",
    "  <the response body, OR the deny reason, OR the counter-offer text>",
    "  --- END PAYLOAD ---",
    "",
    "When generating the payload, lean on actual data from the trust manifest if",
    "the command is asking for content. Do NOT invent specific facts (account",
    "numbers, dates, balances) that aren't in the manifest. If the manifest",
    "doesn't contain enough info, prefer COUNTER-OFFER with a category-level",
    "answer or a polite 'I don't have that detail' DENY.",
  ].join("\n");
}

/** Parse the structured judgment from the guardian's output. */
export function parseJudgment(text: string): CommandJudgment {
  const decisionMatch = text.match(/DECISION:\s*(ALLOW|DENY|COUNTER-OFFER)/i);
  const driftedMatch = text.match(/DRIFTED:\s*(yes|no)/i);
  const ruleMatch = text.match(/RULE:\s*(.+)/);
  const payloadMatch = text.match(
    /---\s*BEGIN PAYLOAD\s*---\s*([\s\S]*?)\s*---\s*END PAYLOAD\s*---/i,
  );

  const rawDecision = decisionMatch ? decisionMatch[1]!.toUpperCase() : "DENY";
  const decision: "allow" | "deny" | "counter-offer" =
    rawDecision === "ALLOW"
      ? "allow"
      : rawDecision === "COUNTER-OFFER"
        ? "counter-offer"
        : "deny";

  const drifted = driftedMatch ? driftedMatch[1]!.toLowerCase() === "yes" : false;
  const ruleCited = ruleMatch ? ruleMatch[1]!.trim() : undefined;
  const payload = payloadMatch ? payloadMatch[1]!.trim() : text.trim();

  const judgment: CommandJudgment = { decision, drifted };
  if (ruleCited) judgment.ruleCited = ruleCited;
  if (decision === "allow") judgment.response = payload;
  else if (decision === "counter-offer") judgment.counterOffer = payload;
  else judgment.denyReason = payload;
  return judgment;
}

/** Have the guardian judge one command. */
export async function judgeCommand(opts: {
  guardian: GuardianClient;
  responderManifest: TrustManifest;
  contract: SessionContract;
  /** The frame text from the wire turn (intent, in plain English). */
  frame: string;
  /** The command body itself. */
  command: string;
  /** Drift state to update. */
  drift: DriftState;
}): Promise<{ judgment: CommandJudgment; driftAction: 0 | 1 | 2 | 3 }> {
  const system = buildWorkSystemPrompt({
    responderManifest: opts.responderManifest,
    contract: opts.contract,
  });
  const user = [
    `INITIATOR FRAME: ${opts.frame}`,
    `INITIATOR COMMAND: ${opts.command}`,
    "",
    `Drift state so far: total=${opts.drift.totalCommands}, drifts=${opts.drift.driftCount}`,
    "",
    "Now produce your structured judgment.",
  ].join("\n");

  const raw = await opts.guardian.ask(system, user);
  const judgment = parseJudgment(raw);

  // Update drift state.
  opts.drift.totalCommands += 1;
  let driftAction: 0 | 1 | 2 | 3 = 0;
  if (judgment.drifted) {
    opts.drift.driftCount += 1;
    opts.drift.driftStep = Math.min(3, (opts.drift.driftStep + 1) as 0 | 1 | 2 | 3) as 0 | 1 | 2 | 3;
    driftAction = opts.drift.driftStep;
    opts.drift.lastDriftAction = driftAction;
  }
  return { judgment, driftAction };
}

/** Translate a drift action into a human-readable label for the log. */
export function driftLabel(action: 0 | 1 | 2 | 3): string {
  switch (action) {
    case 0:
      return "in-scope";
    case 1:
      return "soft-challenge (drift step 1)";
    case 2:
      return "warn (drift step 2)";
    case 3:
      return "terminate (drift step 3)";
  }
}
