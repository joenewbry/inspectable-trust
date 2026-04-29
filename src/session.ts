// Per-session state machines for both the responder side and the initiator side.
//
// The wire is HTTP request/reply: the initiator POSTs a wire message, the
// responder replies with a wire message. This file gives both sides a
// `.step(inbound) -> outbound | { done, outbound? }` function so the HTTP
// server (or an in-memory test transport) can drive them turn-by-turn.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  GuardianClient,
  HandshakeResult,
  HistoryEntry,
  PeerRecord,
  SessionContract,
  SessionPhase,
  TrustManifest,
  WireMessage,
} from "./types.js";
import { decode, command as encCommand, response as encResponse } from "./frame-command.js";
import {
  buildAnswererSystemPrompt,
  buildEvaluatorSystemPrompt,
  buildProberSystemPrompt,
  parseEvaluation,
} from "./handshake.js";
import { generateContract } from "./contract.js";
import {
  driftLabel,
  judgeCommand,
  newDriftState,
  type DriftState,
} from "./work-loop.js";
import { appendEntry } from "./history.js";
import { addStrike, loadPeer, recordSuccessfulInteraction } from "./peers.js";

export interface SessionStepResult {
  /** True iff the session is finished after this step. */
  done: boolean;
  /** Outbound wire message (raw, encoded) to send to the peer. May be undefined when done with no further reply. */
  outbound?: string;
}

// ---- Responder ----

export interface ResponderSessionConfig {
  trustDir: string;
  manifest: TrustManifest;
  guardian: GuardianClient;
  handshake?: { maxRounds: number; passThreshold: number; abortThreshold: number };
}

const DEFAULT_RESP_HS = { maxRounds: 4, passThreshold: 0.7, abortThreshold: 0.2 };

export class ResponderSession {
  readonly id = randomUUID();
  phase: SessionPhase = "open";
  initiatorClaim = "";
  intent = "";
  peerRecord: PeerRecord | null = null;
  handshakeConfidence = 0.5;
  handshakeRound = 0;
  handshakeTrajectory: number[] = [];
  lastProbe = "";
  contract?: SessionContract;
  contractRaw?: string;
  drift: DriftState = newDriftState();
  cost = 0;

  constructor(public cfg: ResponderSessionConfig) {}

  /** Process one inbound wire message and produce an outbound wire message. */
  async step(inboundWire: string): Promise<SessionStepResult> {
    const inbound = decode(inboundWire);
    const handlers: Record<SessionPhase, () => Promise<SessionStepResult>> = {
      open: () => this.handleOpen(inbound),
      handshake: () => this.handleHandshake(inbound),
      grant: () => this.handleGrant(inbound),
      work: () => this.handleWork(inbound),
      close: async () => ({ done: true }),
    };
    const result = await handlers[this.phase]();
    this.cost = this.cfg.guardian.cost;
    return result;
  }

  private log(
    dir: HistoryEntry["dir"],
    p: SessionPhase,
    frame: string,
    body: string,
    decision?: HistoryEntry["decision"],
    ruleCited?: string,
  ): void {
    const e: HistoryEntry = {
      ts: new Date().toISOString(),
      sessionId: this.id,
      dir,
      peer: this.initiatorClaim || "unknown",
      phase: p,
      frame,
      body,
    };
    if (decision) e.decision = decision;
    if (ruleCited) e.ruleCited = ruleCited;
    appendEntry(this.cfg.trustDir, e);
  }

  private async handleOpen(inbound: WireMessage): Promise<SessionStepResult> {
    // Parse OPEN. Body should be like `OPEN as=<slug>`. Frame is the intent.
    const m = inbound.body.match(/^OPEN\s+as=([\w.@:-]+)/i);
    if (!m) {
      return {
        done: true,
        outbound: encResponse(
          "Malformed OPEN. Closing.",
          "expected body of the form `OPEN as=<slug>`",
        ),
      };
    }
    this.initiatorClaim = m[1]!;
    this.intent = inbound.frame;
    this.peerRecord = loadPeer(this.cfg.trustDir, this.initiatorClaim);
    this.log("in", "open", `OPEN from ${this.initiatorClaim}`, this.intent);

    // Move to handshake; emit the first probe.
    this.phase = "handshake";
    return await this.emitProbe();
  }

  private async emitProbe(): Promise<SessionStepResult> {
    const proberSystem = buildProberSystemPrompt({
      myManifest: this.cfg.manifest,
      peerRecord: this.peerRecord,
      peerClaim: this.initiatorClaim,
    });
    const cfg = this.cfg.handshake ?? DEFAULT_RESP_HS;
    const userMsg = `Round ${this.handshakeRound + 1} of ${cfg.maxRounds}. Current confidence: ${this.handshakeConfidence.toFixed(
      2,
    )}. Generate the next probe.`;
    const probe = (await this.cfg.guardian.ask(proberSystem, userMsg)).trim();
    this.lastProbe = probe;
    this.log("out", "handshake", `probe round ${this.handshakeRound + 1}`, probe, "allow", "handshake:probe");
    return {
      done: false,
      outbound: encCommand(`Identity probe ${this.handshakeRound + 1}`, probe),
    };
  }

  private async handleHandshake(inbound: WireMessage): Promise<SessionStepResult> {
    // Inbound should be a response with the answer.
    if (inbound.bodyKind !== "response") {
      return { done: true, outbound: encResponse("Expected probe answer; got something else. Closing.", "PROTOCOL_ERROR") };
    }
    this.log("in", "handshake", "answer", inbound.body);

    // Score it.
    const evalSystem = buildEvaluatorSystemPrompt({
      myManifest: this.cfg.manifest,
      peerRecord: this.peerRecord,
      peerClaim: this.initiatorClaim,
    });
    const evalUser = `My probe was: ${this.lastProbe}\nTheir answer was: ${inbound.body}\n\nScore it.`;
    const rawEval = await this.cfg.guardian.ask(evalSystem, evalUser);
    const { confidence: roundScore, reason } = parseEvaluation(rawEval);
    this.handshakeConfidence = 0.6 * this.handshakeConfidence + 0.4 * roundScore;
    this.handshakeTrajectory.push(this.handshakeConfidence);
    this.handshakeRound += 1;

    const cfg = this.cfg.handshake ?? DEFAULT_RESP_HS;

    if (this.handshakeConfidence >= cfg.passThreshold) {
      // Move to GRANT, emit contract.
      this.phase = "grant";
      const { contract, raw } = await generateContract({
        guardian: this.cfg.guardian,
        responderManifest: this.cfg.manifest,
        initiatorSlug: this.initiatorClaim,
        intent: this.intent,
        handshakeNotes: `passed in ${this.handshakeRound} rounds, confidence ${this.handshakeConfidence.toFixed(2)}`,
        sessionId: this.id,
      });
      this.contract = contract;
      this.contractRaw = raw;
      this.log("internal", "grant", "contract written", contract.scope, "allow", "contract:write");

      // Persist on disk.
      const sessionDir = join(this.cfg.trustDir, "sessions", this.id);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, "contract.md"), raw, "utf8");

      this.log("out", "grant", "contract sent", contract.scope);
      return {
        done: false,
        outbound: encResponse(
          `Handshake passed (confidence ${this.handshakeConfidence.toFixed(2)} after ${this.handshakeRound} rounds). Here is the contract.`,
          raw,
        ),
      };
    }

    if (this.handshakeConfidence <= cfg.abortThreshold || this.handshakeRound >= cfg.maxRounds) {
      this.phase = "close";
      addStrike(this.cfg.trustDir, this.initiatorClaim, `handshake failed (conf ${this.handshakeConfidence.toFixed(2)})`);
      this.log(
        "internal",
        "close",
        `handshake failed: confidence=${this.handshakeConfidence.toFixed(2)} after ${this.handshakeRound} rounds`,
        reason,
        "deny",
        "handshake:threshold",
      );
      return {
        done: true,
        outbound: encResponse(
          `Handshake didn't reach the threshold. Closing without disclosing data. confidence=${this.handshakeConfidence.toFixed(2)} threshold=${cfg.passThreshold}`,
          `last reason: ${reason}`,
        ),
      };
    }

    // Not yet — emit next probe.
    return await this.emitProbe();
  }

  private async handleGrant(inbound: WireMessage): Promise<SessionStepResult> {
    // Expect ACK (or a clarifying question — for v0.1 we only handle ACK).
    this.log("in", "grant", "ack", inbound.body);
    this.phase = "work";
    return {
      done: false,
      outbound: encResponse("Ready for your first command.", "READY"),
    };
  }

  private async handleWork(inbound: WireMessage): Promise<SessionStepResult> {
    // CLOSE detection.
    if (inbound.body.trim().toUpperCase() === "CLOSE") {
      this.log("in", "work", inbound.frame || "close requested", "CLOSE");
      this.phase = "close";
      this.log("internal", "close", `session ended; drift=${driftLabel(this.drift.lastDriftAction)}`, `${this.drift.totalCommands} commands, ${this.drift.driftCount} drifted`);
      recordSuccessfulInteraction(this.cfg.trustDir, this.initiatorClaim);
      return {
        done: true,
        outbound: encResponse("Session closed. Thanks.", "BYE"),
      };
    }

    if (inbound.bodyKind !== "command") {
      // Initiator sent a response when we expected a command. Tolerate; ask for next.
      this.log("in", "work", inbound.frame, inbound.body);
      return { done: false, outbound: encResponse("Ready for your next command.", "READY") };
    }

    this.log("in", "work", inbound.frame, inbound.body);

    const { judgment, driftAction } = await judgeCommand({
      guardian: this.cfg.guardian,
      responderManifest: this.cfg.manifest,
      contract: this.contract!,
      frame: inbound.frame,
      command: inbound.body,
      drift: this.drift,
    });

    let outFrame: string;
    let outBody: string;
    let decisionTag: HistoryEntry["decision"];
    let terminate = false;

    if (driftAction >= 3) {
      outFrame = "Drift threshold exceeded. Closing the session.";
      outBody = "TERMINATE";
      decisionTag = "terminate";
      terminate = true;
    } else if (driftAction === 2) {
      outFrame = `Warning: this is the second out-of-scope request. ${
        judgment.decision === "allow" ? "Answering, but logging the drift." : "Refusing this one."
      }`;
      outBody = judgment.response ?? judgment.counterOffer ?? judgment.denyReason ?? "";
      decisionTag = "drift-warn";
    } else if (driftAction === 1) {
      outFrame = `Soft challenge: that looked outside what we agreed. What were you trying to accomplish?${
        judgment.decision === "allow" ? " I'll answer this one anyway." : ""
      }`;
      outBody = judgment.response ?? judgment.counterOffer ?? judgment.denyReason ?? "";
      decisionTag = "drift-challenge";
    } else if (judgment.decision === "allow") {
      outFrame = "Allowed.";
      outBody = judgment.response!;
      decisionTag = "allow";
    } else if (judgment.decision === "counter-offer") {
      outFrame = "I can't fulfill that exactly. Counter-offer:";
      outBody = judgment.counterOffer!;
      decisionTag = "counter-offer";
    } else {
      outFrame = "Refused.";
      outBody = judgment.denyReason ?? "I can't share that.";
      decisionTag = "deny";
    }

    this.log("out", "work", outFrame, outBody, decisionTag, judgment.ruleCited);

    if (terminate) {
      this.phase = "close";
      addStrike(this.cfg.trustDir, this.initiatorClaim, "terminated for sustained drift");
      return { done: true, outbound: encResponse(outFrame, outBody) };
    }

    return { done: false, outbound: encResponse(outFrame, outBody) };
  }

  /** Snapshot state for tests / debugging. */
  snapshot(): {
    sessionId: string;
    phase: SessionPhase;
    handshake: HandshakeResult;
    contract?: SessionContract;
    drift: DriftState;
    cost: number;
  } {
    return {
      sessionId: this.id,
      phase: this.phase,
      handshake: {
        passed: this.phase !== "handshake" && this.phase !== "open" && this.contract !== undefined,
        confidence: this.handshakeConfidence,
        rounds: this.handshakeRound,
        trajectory: [...this.handshakeTrajectory],
        reason: this.contract ? "passed" : `phase=${this.phase}`,
      },
      ...(this.contract ? { contract: this.contract } : {}),
      drift: { ...this.drift },
      cost: this.cost,
    };
  }
}

// ---- Initiator ----

export interface InitiatorSessionConfig {
  trustDir: string;
  manifest: TrustManifest;
  guardian: GuardianClient;
  responderSlug: string;
  intent: string;
  /** Sequential commands to issue. */
  commands: { frame: string; command: string }[];
}

export class InitiatorSession {
  contractReceived?: string;
  turns: { outFrame: string; outBody: string; inFrame: string; inBody: string }[] = [];
  finished = false;
  reason = "";
  cost = 0;
  /** Index of next command to send. */
  private cmdIdx = 0;

  constructor(public cfg: InitiatorSessionConfig) {}

  /** First message to send (the OPEN). */
  openMessage(): string {
    return encCommand(this.cfg.intent, `OPEN as=${this.cfg.manifest.slug}`);
  }

  /** Process one inbound message; return next outbound or null when done. */
  async respond(inboundWire: string): Promise<string | null> {
    const inbound = decode(inboundWire);

    // BYE
    if (inbound.body.trim().toUpperCase() === "BYE") {
      this.finished = true;
      this.reason = "responder said BYE";
      this.cost = this.cfg.guardian.cost;
      return null;
    }

    // TERMINATE
    if (inbound.body.trim().toUpperCase() === "TERMINATE") {
      this.finished = true;
      this.reason = `terminated: ${inbound.frame}`;
      this.cost = this.cfg.guardian.cost;
      return null;
    }

    // Handshake-fail close.
    if (inbound.frame.toLowerCase().includes("handshake didn't reach") || /confidence=/.test(inbound.body)) {
      this.finished = true;
      this.reason = inbound.frame;
      this.cost = this.cfg.guardian.cost;
      return null;
    }

    // Probe.
    if (inbound.bodyKind === "command") {
      const sys = buildAnswererSystemPrompt({
        myManifest: this.cfg.manifest,
        peerClaim: this.cfg.responderSlug,
      });
      const ans = (await this.cfg.guardian.ask(sys, `Probe from peer: ${inbound.body}`)).trim();
      this.cost = this.cfg.guardian.cost;
      return encResponse("Answering your probe.", ans);
    }

    // Contract.
    if (/##\s*Scope/i.test(inbound.body)) {
      this.contractReceived = inbound.body;
      // For v0.1 we just ack.
      this.cost = this.cfg.guardian.cost;
      return encResponse("Acknowledged. Ready to issue commands.", "ACK");
    }

    // After our previous command, this is the responder's reply. Record it.
    if (this.turns.length > 0 && !this.lastReplyRecorded) {
      const t = this.turns[this.turns.length - 1]!;
      t.inFrame = inbound.frame;
      t.inBody = inbound.body;
      this.lastReplyRecorded = true;
    }

    // READY → send next command, or CLOSE if exhausted.
    if (this.cmdIdx >= this.cfg.commands.length) {
      this.cost = this.cfg.guardian.cost;
      return encCommand("close session, thanks", "CLOSE");
    }

    const next = this.cfg.commands[this.cmdIdx++]!;
    this.turns.push({
      outFrame: next.frame,
      outBody: next.command,
      inFrame: "",
      inBody: "",
    });
    this.lastReplyRecorded = false;
    this.cost = this.cfg.guardian.cost;
    return encCommand(next.frame, next.command);
  }

  private lastReplyRecorded = true;
}

// ---- In-memory transport for tests ----

/**
 * Run an entire session in-memory by ping-ponging between initiator and responder.
 * Returns when either side signals done.
 */
export async function runInMemorySession(
  initiator: InitiatorSession,
  responder: ResponderSession,
  maxSteps = 60,
): Promise<{
  initiator: InitiatorSession;
  responder: ResponderSession;
  steps: number;
}> {
  let outbound = initiator.openMessage();
  let steps = 0;

  for (steps = 0; steps < maxSteps; steps++) {
    // Responder steps with initiator's outbound.
    const respResult = await responder.step(outbound);
    if (respResult.done) {
      // Let the initiator process the final outbound, if any.
      if (respResult.outbound) {
        await initiator.respond(respResult.outbound);
      }
      initiator.finished = true;
      break;
    }

    // Initiator processes responder's outbound and produces next outbound.
    const next = await initiator.respond(respResult.outbound!);
    if (next === null) {
      initiator.finished = true;
      break;
    }
    outbound = next;
  }

  return { initiator, responder, steps };
}
