// Whitelisted, read-only shell execution for v0.2 WORK turns.
//
// The guardian decides allow/deny at the policy level. This module is the
// belt-and-suspenders enforcement: even if the guardian allows something the
// trust.md didn't anticipate, the actual exec layer refuses anything not on
// the whitelist or that touches a denied path.
//
// No shell metacharacter parsing — we spawn the command directly with argv,
// which means `&&`, `|`, `;`, backticks, `$(...)` are all just literal
// characters passed as one arg (and will fail because the binary won't
// understand them). That's the point: no shell injection surface.

import { spawn } from "node:child_process";
import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";

/** Commands that may run. Each accepts arbitrary paths and pattern args. */
const SHELL_WHITELIST = new Set([
  "rg", "find", "cat", "head", "tail", "ls", "wc", "file", "stat", "tree",
  "echo", "true", "false",
]);

/** Path prefixes that are NEVER readable, regardless of contract. */
const PATH_DENYLIST_PREFIXES = [
  "/etc/",
  "/run/",
  "/root/",
  "/proc/",
  "/sys/",
  "/var/log/",
  "/var/lib/",
  "/boot/",
  homedir() + "/.trust/",
  homedir() + "/.config/",
  homedir() + "/.ssh/",
  homedir() + "/.aws/",
  homedir() + "/.gnupg/",
  homedir() + "/Library/",
  "/home/prometheus/.trust/",
  "/home/prometheus/.config/",
  "/home/prometheus/.ssh/",
  "/home/prometheus/.cloudflared/",
];

/** Substrings that nuke a path no matter where they appear. */
const PATH_DENYLIST_SUBSTRINGS = [
  "secrets",
  "credentials",
  "vault",
  "aliases",
  "/identity.txt",
  "/recipients.txt",
];

/** Filename patterns that are always blocked, anywhere on disk. */
const FILENAME_DENYLIST_REGEX = [
  /\.env(\.|$)/,
  /\.env$/,
  /^id_rsa/,
  /^id_ed25519/,
  /\.key$/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
];

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  durationMs: number;
}

export interface ExecOptions {
  /** Wall-clock timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Max stdout bytes captured. Default 256 KB. */
  maxStdoutBytes?: number;
  /** Working directory. Default cwd. */
  cwd?: string;
}

/**
 * Parse a shell-ish command string into argv. Splits on whitespace, respects
 * single and double quotes, and rejects any input with shell metacharacters
 * outside quotes.
 */
export function tokenizeCommand(input: string): { argv: string[]; rejection?: string } {
  const trimmed = input.trim();
  if (!trimmed) return { argv: [], rejection: "empty command" };

  // Block dangerous chars in unquoted positions. We allow them inside quoted
  // string args (so `rg "TODO|FIXME"` works) but not raw.
  const rejected: string[] = [];
  const argv: string[] = [];
  let i = 0;
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  while (i < trimmed.length) {
    const ch = trimmed[i]!;
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        cur += ch;
      }
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === "\\" && i + 1 < trimmed.length) {
        cur += trimmed[i + 1];
        i += 2;
        continue;
      } else {
        cur += ch;
      }
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        argv.push(cur);
        cur = "";
      }
      i++;
      continue;
    }
    // Dangerous unquoted metacharacters.
    if ("|&;`$<>(){}".includes(ch)) {
      rejected.push(ch);
    }
    cur += ch;
    i++;
  }
  if (cur) argv.push(cur);
  if (inSingle || inDouble) {
    return { argv: [], rejection: "unterminated quote in command" };
  }
  if (rejected.length > 0) {
    return {
      argv: [],
      rejection: `shell metacharacter(s) not allowed outside quotes: ${[...new Set(rejected)].join(" ")}`,
    };
  }
  return { argv };
}

/**
 * Return a rejection string if the path is denied, or null if OK.
 * Paths are resolved relative to `cwd`; the absolute form is what we check.
 */
export function checkPath(path: string, cwd: string): string | null {
  const abs = isAbsolute(path) ? path : resolve(cwd, path);
  for (const prefix of PATH_DENYLIST_PREFIXES) {
    if (abs.startsWith(prefix)) return `path inside denied prefix ${prefix}`;
  }
  for (const sub of PATH_DENYLIST_SUBSTRINGS) {
    if (abs.toLowerCase().includes(sub)) return `path contains denied substring "${sub}"`;
  }
  const base = abs.split("/").pop() ?? "";
  for (const re of FILENAME_DENYLIST_REGEX) {
    if (re.test(base)) return `filename matches denied pattern ${re}`;
  }
  return null;
}

/**
 * Scan an argv for path-shaped arguments and reject if any are denied. We
 * heuristically treat anything that starts with `/`, `./`, `../`, `~/`, or
 * doesn't start with a dash as a candidate path (false positives for
 * patterns / regex don't matter — they won't match the denylist).
 */
function checkArgsForPaths(argv: string[], cwd: string): string | null {
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("-")) continue; // flag
    // Treat as path if it looks remotely like one.
    const candidate = a.startsWith("~/") ? a.replace(/^~/, homedir()) : a;
    const denied = checkPath(candidate, cwd);
    if (denied) return `arg #${i} ("${a}"): ${denied}`;
  }
  return null;
}

/**
 * Run a whitelisted command. Returns the result or a rejection string.
 */
export async function executeShell(
  commandText: string,
  opts: ExecOptions = {},
): Promise<{ result?: ExecResult; rejection?: string }> {
  const { argv, rejection } = tokenizeCommand(commandText);
  if (rejection) return { rejection };
  if (argv.length === 0) return { rejection: "empty command" };

  const bin = argv[0]!;
  if (!SHELL_WHITELIST.has(bin)) {
    return {
      rejection: `command "${bin}" is not on the read-only whitelist (${[...SHELL_WHITELIST].sort().join(", ")})`,
    };
  }

  const cwd = opts.cwd ?? process.cwd();
  const pathRejection = checkArgsForPaths(argv, cwd);
  if (pathRejection) return { rejection: pathRejection };

  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxBytes = opts.maxStdoutBytes ?? 256 * 1024;
  const start = Date.now();

  return new Promise((resolveFn) => {
    const child = spawn(bin, argv.slice(1), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "en_US.UTF-8" },
    });

    let stdoutBuf = Buffer.alloc(0);
    let stderrBuf = Buffer.alloc(0);
    let truncated = false;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBuf.length >= maxBytes) {
        truncated = true;
        return;
      }
      const remaining = maxBytes - stdoutBuf.length;
      stdoutBuf = Buffer.concat([stdoutBuf, chunk.subarray(0, remaining)]);
      if (chunk.length > remaining) truncated = true;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBuf.length < 16 * 1024) {
        stderrBuf = Buffer.concat([stderrBuf, chunk]);
      }
    });

    const killTimer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolveFn({
        result: {
          stdout: stdoutBuf.toString("utf8"),
          stderr: stderrBuf.toString("utf8"),
          exitCode: code ?? -1,
          truncated,
          durationMs: Date.now() - start,
        },
      });
    });

    child.on("error", (err) => {
      clearTimeout(killTimer);
      resolveFn({
        result: {
          stdout: "",
          stderr: `spawn error: ${(err as Error).message}`,
          exitCode: -1,
          truncated: false,
          durationMs: Date.now() - start,
        },
      });
    });
  });
}

/** Detect whether a free-form command text looks like a whitelisted shell command. */
export function looksLikeShell(commandText: string): boolean {
  const trimmed = commandText.trim();
  const firstWord = trimmed.split(/\s+/)[0] ?? "";
  return SHELL_WHITELIST.has(firstWord);
}

/** Detect whether a free-form command text looks like a read-only SQL query. */
export function looksLikeSql(commandText: string): boolean {
  const trimmed = commandText.trim().replace(/^\s*--[^\n]*\n/gm, "").trim();
  return /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(trimmed);
}

/** Format an ExecResult into a single string body for the wire response. */
export function formatExecResult(r: ExecResult): string {
  const parts: string[] = [];
  if (r.stdout) parts.push(r.stdout.replace(/\n+$/, ""));
  if (r.stderr) parts.push(`--- stderr ---\n${r.stderr.replace(/\n+$/, "")}`);
  if (r.exitCode !== 0) parts.push(`--- exit code ${r.exitCode} ---`);
  if (r.truncated) parts.push("--- output truncated ---");
  return parts.join("\n");
}
