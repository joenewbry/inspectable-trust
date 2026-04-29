// Test fixture helper for integration tests.
// Copies an example persona to a fresh temp dir so tests don't pollute examples/.

import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;

export function copyPersonaToTempDir(personaName: string): {
  identityDir: string;
  trustDir: string;
  cleanup: () => void;
} {
  const tmp = mkdtempSync(join(tmpdir(), `trust-fixture-${personaName}-`));
  const src = join(REPO_ROOT, "examples", personaName);
  const dst = join(tmp, personaName);
  cpSync(src, dst, { recursive: true });
  return {
    identityDir: dst,
    trustDir: join(dst, ".trust"),
    cleanup: () => {
      // We deliberately leave the tmp dir on disk for postmortem inspection if
      // a test fails. macOS will clean tmp eventually.
    },
  };
}

/** Skip the test if no Anthropic API key is configured. */
export function requireAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
