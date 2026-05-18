// PII Shield — rewrites every WORK-phase response, substituting real PII
// (names, emails, addresses, IDs) with plausible-but-unrelated synthesized
// alternatives wrapped in `[~...~]`. Real→fake mappings are persisted to a
// per-session `aliases.md` file so the same real user always reads as the
// same fake user within a session.
//
// The aliases.md file is daemon-internal. It NEVER crosses the wire. On
// session close it gets age-encrypted by src/seal.ts and moved to the audit
// directory.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GuardianClient } from "./types.js";

export interface RedactionContext {
  /** Absolute path to the per-session aliases.md file. */
  aliasesPath: string;
  /** Session id, used in alias-table comments. */
  sessionId: string;
  /** A 1-based turn counter, used in alias-table "first seen". */
  turnNumber: number;
  /** Guardian for the Haiku call. Reuses the same GuardianClient. */
  guardian: GuardianClient;
}

export interface RedactionResult {
  redactedBody: string;
  newAliasCount: number;
  reusedAliasCount: number;
}

const PII_SHIELD_SYSTEM = `You are a PII shield for an inspectable-trust endpoint that serves a partner LLM. You receive raw results from a read-only query and rewrite them.

Your job is NOT to remove information — it's to substitute every piece of personally identifying information with a *plausible but unrelated* alternative, and mark the substitution so the downstream LLM knows the value is synthesized.

## What counts as PII

Real-person names (first, last, business names tied to a person), email addresses, phone numbers, street addresses, full ZIP codes, claim/notice/account/order IDs that look real, Stripe customer IDs, internal user IDs, full dates of birth, IP addresses, Gmail message IDs, raw subject lines from real emails, and any free-text quote that contains any of the above.

Aggregates (counts, sums, means, percentiles), code, documentation, public URLs, settlement names, settlement payout figures, timestamps rounded to the day, and city/state names appearing as analytic facts (not as someone's address) are NOT PII. Pass them through verbatim.

## How to synthesize

For each PII value:
- Pick a plausible alternative of the same *shape* (a real-looking name, a real-looking email, a real-looking city) but **deliberately unrelated** to the original. Different first letter. Different email domain. Different region or country. The shape is preserved; the content is unrelated.
- Be consistent: if the same real value appears multiple times in this response, use the same synthesized value.
- Wrap every synthesized value in \`[~...~]\` — both brackets always present. Example: \`[~Maria Alvarez~]\`, \`[~maria.a@protonmail.com~]\`, \`[~Queens, NY~]\`.
- If the existing alias table below already has a mapping for a real value, REUSE the synthesized value verbatim. Do NOT invent a new one. This is the most important rule — partners depend on cross-turn consistency.

## What to write — EXACT output rules

**Do NOT add any header, footer, divider, code-fence, or explanatory text around the redacted body.** Emit the redacted body itself as the FIRST characters of your output, formatted exactly like the input was. No "BEGIN REDACTED BODY" markers, no "Here is the redacted output:" preamble, no code fences unless the input had code fences.

After the redacted body, on its own line, exactly one stats line:

\`--- shielded: N values synthesized (M new, K reused) ---\`

where N = total brackets in your output, M = new aliases added, K = aliases reused from the existing table. If N=0 (input had no PII), still emit the stats line: \`--- shielded: 0 values synthesized (0 new, 0 reused) ---\`.

If you added any new aliases, append exactly one block at the very end:

\`\`\`
--- new aliases ---
| real value | synthesized value | first seen |
|---|---|---|
| <real> | <synthesized, no brackets> | turn <N> |
\`\`\`

If no new aliases were added, omit the \`--- new aliases ---\` block entirely.

The downstream code parses on the literal strings \`--- shielded:\` and \`--- new aliases ---\`. Don't paraphrase them.

## Refusal case

If you encounter PII you cannot safely synthesize (e.g., the entire result is a single identifying string with no surrounding context), return ONLY this:

\`\`\`
counter-offer: I can give you the aggregate shape of this result, not the row itself.
\`\`\`

Do nothing else in that case.`;

/**
 * Pass `rawBody` through the PII shield. Updates aliases.md atomically on disk.
 */
export async function redact(
  rawBody: string,
  ctx: RedactionContext,
): Promise<RedactionResult> {
  const existing = readAliasesMd(ctx.aliasesPath);
  const userMsg = buildUserMessage(rawBody, existing, ctx.turnNumber);
  const raw = (await ctx.guardian.ask(PII_SHIELD_SYSTEM, userMsg)).trim();

  // Counter-offer short-circuit.
  if (/^counter-offer:/i.test(raw)) {
    return { redactedBody: raw, newAliasCount: 0, reusedAliasCount: 0 };
  }

  const { body, newAliases, totals } = parseShieldedResponse(raw);

  if (newAliases.length > 0) {
    appendAliases(ctx.aliasesPath, ctx.sessionId, newAliases);
  }
  return {
    redactedBody: body,
    newAliasCount: newAliases.length,
    reusedAliasCount: totals.reused,
  };
}

interface AliasRow {
  real: string;
  synthesized: string;
  firstSeen: string;
}

/** Read the aliases.md file into in-memory rows. */
function readAliasesMd(path: string): AliasRow[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf8");
  const rows: AliasRow[] = [];
  for (const line of content.split("\n")) {
    // Match a markdown table row with 3 cells.
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!m) continue;
    const [, a, b, c] = m;
    if (a === "real value" || a?.match(/^-+$/)) continue; // header / separator
    rows.push({ real: a!, synthesized: b!, firstSeen: c! });
  }
  return rows;
}

function aliasesAsTable(rows: AliasRow[]): string {
  if (rows.length === 0) return "(no aliases yet — this is the first redacted turn of the session)";
  const header = "| real value | synthesized value | first seen |";
  const sep = "|---|---|---|";
  const body = rows.map((r) => `| ${r.real} | ${r.synthesized} | ${r.firstSeen} |`).join("\n");
  return `${header}\n${sep}\n${body}`;
}

function buildUserMessage(rawBody: string, existing: AliasRow[], turn: number): string {
  return [
    `Existing aliases for this session (REUSE these — same real value must always map to the same synthesized value):`,
    "",
    aliasesAsTable(existing),
    "",
    `This is turn ${turn}.`,
    "",
    "Raw body to shield (rewrite this with PII synthesized):",
    "",
    "----- BEGIN RAW BODY -----",
    rawBody,
    "----- END RAW BODY -----",
  ].join("\n");
}

interface ParsedShield {
  body: string;
  newAliases: AliasRow[];
  totals: { brackets: number; reused: number };
}

function parseShieldedResponse(raw: string): ParsedShield {
  // Extract the new-aliases block if present.
  const aliasMatch = raw.match(/---\s*new aliases\s*---\s*\n([\s\S]*?)$/i);
  let bodyAndStats = raw;
  let newAliases: AliasRow[] = [];
  if (aliasMatch) {
    bodyAndStats = raw.slice(0, aliasMatch.index!).trimEnd();
    newAliases = parseAliasTable(aliasMatch[1]!);
  }

  // Extract the shielded stats line.
  const statsMatch = bodyAndStats.match(
    /---\s*shielded:\s*(\d+)\s*values\s*synthesized\s*\((\d+)\s*new,\s*(\d+)\s*reused\)\s*---/i,
  );
  let body = bodyAndStats;
  let totals = { brackets: 0, reused: 0 };
  if (statsMatch) {
    body = bodyAndStats.slice(0, statsMatch.index!).trimEnd();
    totals = { brackets: Number(statsMatch[1]), reused: Number(statsMatch[3]) };
  } else {
    // Fall back: count brackets in body.
    totals.brackets = (body.match(/\[~[^~]+~\]/g) || []).length;
  }

  return { body, newAliases, totals };
}

function parseAliasTable(text: string): AliasRow[] {
  const rows: AliasRow[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!m) continue;
    const [, a, b, c] = m;
    if (a === "real value" || a?.match(/^-+$/)) continue;
    rows.push({ real: a!, synthesized: b!, firstSeen: c! });
  }
  return rows;
}

function appendAliases(path: string, sessionId: string, rows: AliasRow[]): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(
      path,
      [
        `# Session ${sessionId} — alias map`,
        `# Created ${new Date().toISOString()}. Append-only. Daemon-internal — never sent on the wire.`,
        "",
        "| real value | synthesized value | first seen |",
        "|---|---|---|",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
  }
  const lines = rows.map((r) => `| ${r.real} | ${r.synthesized} | ${r.firstSeen} |`).join("\n") + "\n";
  appendFileSync(path, lines, "utf8");
}

/** Test seam: deterministic pseudo-redaction for unit tests without LLM. */
export function makeStubRedaction(): {
  redact: (raw: string, ctx: RedactionContext) => Promise<RedactionResult>;
  reset: () => void;
} {
  const memory = new Map<string, string>();
  let counter = 0;
  return {
    async redact(raw, ctx) {
      // Trivial: replace anything matching the pattern joeNAME@example.com / "Joe Smith" / etc.
      // For tests, we treat each unique whitespace-bounded token >= 4 chars containing @ or
      // CamelCase as PII. Real implementation uses Haiku.
      const tokens = raw.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)?|\S+@\S+\.\S+/g) ?? [];
      let body = raw;
      let newCount = 0;
      let reusedCount = 0;
      const newAliases: AliasRow[] = [];
      for (const tok of [...new Set(tokens)]) {
        let synth = memory.get(tok);
        if (!synth) {
          counter += 1;
          synth = tok.includes("@") ? `synth${counter}@example.org` : `Synth Person ${counter}`;
          memory.set(tok, synth);
          newAliases.push({ real: tok, synthesized: synth, firstSeen: `turn ${ctx.turnNumber}` });
          newCount += 1;
        } else {
          reusedCount += 1;
        }
        body = body.split(tok).join(`[~${synth}~]`);
      }
      if (newAliases.length > 0) appendAliases(ctx.aliasesPath, ctx.sessionId, newAliases);
      return { redactedBody: body, newAliasCount: newCount, reusedAliasCount: reusedCount };
    },
    reset() {
      memory.clear();
      counter = 0;
    },
  };
}
