// Scenario runner — runs an end-to-end session between two personas, saves a
// human-readable transcript to docs/overnight-run/transcripts/, and returns
// the structured outcome for assertions.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Guardian } from "../../src/guardian.js";
import { loadManifest } from "../../src/trust-md.js";
import {
  ResponderSession,
  InitiatorSession,
  runInMemorySession,
} from "../../src/session.js";
import { readEntries } from "../../src/history.js";
import { copyPersonaToTempDir } from "../integration/_fixture.js";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;

export interface ScenarioOutcome {
  passed: boolean;
  handshake: { confidence: number; rounds: number; trajectory: number[] };
  contract?: string;
  drift: { totalCommands: number; driftCount: number };
  cost: { responder: number; initiator: number; total: number };
  reason: string;
  /** Path to the saved transcript file. */
  transcriptPath: string;
}

export interface ScenarioConfig {
  /** Slug of the scenario (used for the transcript filename). */
  slug: string;
  /** Display title for the transcript header. */
  title: string;
  /** Brief description of what the scenario tests. */
  description: string;
  /** The initiator persona name (in examples/). */
  initiatorPersona: string;
  /** The responder persona name (in examples/). */
  responderPersona: string;
  /** What slug the initiator claims to be (defaults to initiatorPersona). */
  initiatorClaim?: string;
  /** Plain-English intent to pass in the OPEN message. */
  intent: string;
  /** Sequential commands to issue after handshake passes. */
  commands: { frame: string; command: string }[];
  /** Maxsteps for the in-memory session (default 30). */
  maxSteps?: number;
  /** Handshake config overrides. */
  handshake?: { maxRounds: number; passThreshold: number; abortThreshold: number };
}

export async function runScenario(cfg: ScenarioConfig): Promise<ScenarioOutcome> {
  const initSrc = copyPersonaToTempDir(cfg.initiatorPersona);
  const respSrc = copyPersonaToTempDir(cfg.responderPersona);

  const initManifest = loadManifest(initSrc.trustDir);
  const respManifest = loadManifest(respSrc.trustDir);
  const initClaim = cfg.initiatorClaim ?? cfg.initiatorPersona;
  initManifest.slug = initClaim;

  const initGuardian = new Guardian({ maxTokens: 400 });
  const respGuardian = new Guardian({ maxTokens: 600 });

  const responder = new ResponderSession({
    trustDir: respSrc.trustDir,
    manifest: respManifest,
    guardian: respGuardian,
    handshake: cfg.handshake ?? { maxRounds: 3, passThreshold: 0.6, abortThreshold: 0.18 },
  });
  const initiator = new InitiatorSession({
    trustDir: initSrc.trustDir,
    manifest: initManifest,
    guardian: initGuardian,
    responderSlug: cfg.responderPersona,
    intent: cfg.intent,
    commands: cfg.commands,
  });

  await runInMemorySession(initiator, responder, cfg.maxSteps ?? 40);

  const snap = responder.snapshot();
  const transcriptPath = saveTranscript(cfg, initiator, responder, snap, respGuardian, initGuardian);

  return {
    passed: snap.contract !== undefined,
    handshake: {
      confidence: snap.handshake.confidence,
      rounds: snap.handshake.rounds,
      trajectory: [...snap.handshake.trajectory],
    },
    ...(snap.contract ? { contract: responder.contractRaw } : {}),
    drift: {
      totalCommands: snap.drift.totalCommands,
      driftCount: snap.drift.driftCount,
    },
    cost: {
      responder: respGuardian.cost,
      initiator: initGuardian.cost,
      total: respGuardian.cost + initGuardian.cost,
    },
    reason: initiator.reason || (snap.contract ? "completed" : "did not complete"),
    transcriptPath,
  };
}

function saveTranscript(
  cfg: ScenarioConfig,
  initiator: InitiatorSession,
  responder: ResponderSession,
  snap: ReturnType<ResponderSession["snapshot"]>,
  respGuardian: Guardian,
  initGuardian: Guardian,
): string {
  const dir = join(REPO_ROOT, "docs", "overnight-run", "transcripts");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${cfg.slug}.md`);

  // Pull the responder's log entries for this session.
  const entries = readEntries(responder.cfg.trustDir).filter(
    (e: any) => "sessionId" in e && e.sessionId === responder.id,
  );

  const md: string[] = [];
  md.push(`# Scenario: ${cfg.title}`);
  md.push("");
  md.push(`*${cfg.description}*`);
  md.push("");
  md.push(`- Initiator: \`${cfg.initiatorPersona}\` (claiming "${cfg.initiatorClaim ?? cfg.initiatorPersona}")`);
  md.push(`- Responder: \`${cfg.responderPersona}\``);
  md.push(`- Provider: ${respGuardian.provider}`);
  md.push("");
  md.push("## Outcome");
  md.push("");
  md.push(`- Handshake: **${snap.handshake.passed ? "PASSED" : "FAILED"}** at confidence ${snap.handshake.confidence.toFixed(2)} after ${snap.handshake.rounds} round(s)`);
  if (snap.handshake.trajectory.length) {
    md.push(`- Trajectory: ${snap.handshake.trajectory.map((c: number) => c.toFixed(2)).join(" → ")}`);
  }
  md.push(`- Commands issued: ${snap.drift.totalCommands} (drifted: ${snap.drift.driftCount})`);
  md.push(`- Cost: $${(respGuardian.cost + initGuardian.cost).toFixed(4)} (responder $${respGuardian.cost.toFixed(4)}, initiator $${initGuardian.cost.toFixed(4)})`);
  md.push(`- Final reason: ${initiator.reason || "completed"}`);
  md.push("");

  if (snap.contract) {
    md.push("## Contract written by responder");
    md.push("");
    md.push("```markdown");
    md.push(responder.contractRaw ?? "");
    md.push("```");
    md.push("");
  }

  md.push("## Wire transcript");
  md.push("");
  md.push("Each turn is a `FRAME` (intent in plain English) plus a `COMMAND` or `RESPONSE` body, separated by `---` on the wire.");
  md.push("");

  for (const e of entries as any[]) {
    const arrow = e.dir === "in" ? "←  initiator" : e.dir === "out" ? "→  responder" : "·  internal";
    md.push(`### \`${e.phase}\` · ${arrow}${e.decision ? ` · ${e.decision}` : ""}`);
    md.push("");
    md.push("```");
    md.push(`FRAME: ${e.frame}`);
    md.push(`---`);
    md.push(e.body);
    md.push("```");
    if (e.ruleCited) {
      md.push("");
      md.push(`*rule cited: \`${e.ruleCited}\`*`);
    }
    md.push("");
  }

  writeFileSync(path, md.join("\n"), "utf8");
  return path;
}
