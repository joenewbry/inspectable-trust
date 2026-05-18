// Session-close hook: age-encrypt the per-session aliases.md and move it to
// the audit directory. Plaintext is deleted. The audit file can only be
// decrypted with the operator's age identity.
//
// We shell out to the `age` binary (one of the rare external deps); writing
// a JS implementation of age would be larger than the rest of this module
// combined and adds no value over a battle-tested binary.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SealOptions {
  /** Per-session aliases.md path (will be deleted on success). */
  aliasesPath: string;
  /** Audit root, e.g. `/home/prometheus/.trust/audit`. */
  auditRoot: string;
  /** Path to the recipients.txt file (one or more age public keys). */
  recipientsPath: string;
  /** Session id (used to name the sealed file). */
  sessionId: string;
  /** Override the age binary path (test seam). */
  ageBin?: string;
}

export interface SealResult {
  sealedPath: string;
  bytesEncrypted: number;
  durationMs: number;
}

/**
 * Move aliases.md → audit/<YYYY-MM>/<session-id>.aliases.md.age, encrypted.
 * No-op if aliases.md doesn't exist (session had no PII to shield).
 */
export async function sealSession(opts: SealOptions): Promise<SealResult | null> {
  if (!existsSync(opts.aliasesPath)) return null;
  if (!existsSync(opts.recipientsPath)) {
    throw new Error(`seal: recipients file not found at ${opts.recipientsPath}`);
  }
  const stat = statSync(opts.aliasesPath);
  if (stat.size === 0) {
    unlinkSync(opts.aliasesPath);
    return null;
  }

  const yyyymm = new Date().toISOString().slice(0, 7);
  const outDir = join(opts.auditRoot, yyyymm);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${opts.sessionId}.aliases.md.age`);

  const start = Date.now();
  await runAge({
    ageBin: opts.ageBin ?? "age",
    args: ["--encrypt", "-R", opts.recipientsPath, "-o", outPath, opts.aliasesPath],
  });
  unlinkSync(opts.aliasesPath);
  return { sealedPath: outPath, bytesEncrypted: stat.size, durationMs: Date.now() - start };
}

/**
 * Decrypt an audit-sealed file to text. Requires the operator's age identity.
 */
export async function unsealSession(opts: {
  sealedPath: string;
  identityPath: string;
  ageBin?: string;
}): Promise<string> {
  if (!existsSync(opts.sealedPath)) {
    throw new Error(`unseal: not found at ${opts.sealedPath}`);
  }
  if (!existsSync(opts.identityPath)) {
    throw new Error(`unseal: identity not found at ${opts.identityPath}`);
  }
  return await runAge({
    ageBin: opts.ageBin ?? "age",
    args: ["--decrypt", "-i", opts.identityPath, opts.sealedPath],
    captureStdout: true,
  });
}

function runAge(opts: { ageBin: string; args: string[]; captureStdout?: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.ageBin, opts.args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`age exited ${code}: ${stderr.trim() || "unknown"}`));
        return;
      }
      resolve(opts.captureStdout ? stdout : stderr.trim());
    });
    child.on("error", (err) => reject(err));
  });
}

/** Pre-flight: check that `age` is installed. */
export async function checkAgeAvailable(ageBin = "age"): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(ageBin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

/** Convenience: load the first recipient out of recipients.txt. */
export function readPrimaryRecipient(recipientsPath: string): string | null {
  if (!existsSync(recipientsPath)) return null;
  const lines = readFileSync(recipientsPath, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    if (l.startsWith("#")) continue;
    if (l.startsWith("age1")) return l;
  }
  return null;
}

// Re-export for use from dirname() in tests.
export { dirname };
