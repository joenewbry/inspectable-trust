// HTTP daemon. One process per host; supports multiple personas via `--multi`.
//
// Routes (single-persona mode, when started with --root <path>):
//   GET  /trust.md            → serve the persona's trust.md
//   GET  /history.log         → serve the persona's history.log (truncated)
//   GET  /health              → simple ping
//   POST /sessions            → start a new session; body is the OPEN wire message
//   POST /sessions/:id/turn   → exchange one wire turn
//
// Routes (multi-persona mode, when started with --multi <root>):
//   GET  /personas            → list slugs
//   GET  /personas/:slug/trust.md
//   GET  /personas/:slug/history.log
//   POST /personas/:slug/sessions
//   POST /personas/:slug/sessions/:id/turn

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { findIdentityRoot } from "./identity.js";
import { loadManifest } from "./trust-md.js";
import { ResponderSession, type ResponderSessionConfig } from "./session.js";
import { Guardian } from "./guardian.js";
import { ensureLog } from "./history.js";

interface DaemonOptions {
  /** Single-persona mode: path to the persona's identity dir (containing .trust/). */
  root?: string;
  /** Multi-persona mode: path to a parent dir of persona folders. */
  multi?: string;
  port?: number;
  host?: string;
  /** Use a stub guardian that returns canned responses (for tests / dev). */
  stubGuardian?: boolean;
}

interface PersonaCtx {
  slug: string;
  trustDir: string;
  manifest: ReturnType<typeof loadManifest>;
  guardian: Guardian;
  sessions: Map<string, ResponderSession>;
}

export function startDaemon(opts: DaemonOptions = {}): { close: () => void; port: number } {
  const port = opts.port ?? 8500;
  const host = opts.host ?? "127.0.0.1";

  const personas = new Map<string, PersonaCtx>();

  const loadPersona = (identityDir: string, slug: string) => {
    const trustDir = join(identityDir, ".trust");
    if (!existsSync(trustDir)) {
      throw new Error(`No .trust/ folder at ${identityDir}`);
    }
    ensureLog(trustDir);
    const manifest = loadManifest(trustDir);
    const guardian = new Guardian();
    personas.set(slug, {
      slug,
      trustDir,
      manifest,
      guardian,
      sessions: new Map(),
    });
  };

  if (opts.root) {
    const id = findIdentityRoot(opts.root);
    if (!id) throw new Error(`No .trust/ at or above ${opts.root}`);
    loadPersona(id.identityDir, id.slug);
  } else if (opts.multi) {
    if (!existsSync(opts.multi) || !statSync(opts.multi).isDirectory()) {
      throw new Error(`--multi expects a directory: ${opts.multi}`);
    }
    for (const entry of readdirSync(opts.multi)) {
      const dir = join(opts.multi, entry);
      if (statSync(dir).isDirectory() && existsSync(join(dir, ".trust"))) {
        loadPersona(dir, entry);
      }
    }
  } else {
    throw new Error("Daemon needs --root or --multi");
  }

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res, personas, opts);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain");
        res.end((err as Error).message);
      }
    }
  });

  server.listen(port, host, () => {
    console.error(
      `[trust-daemon] listening on http://${host}:${port} (personas: ${[...personas.keys()].join(", ")})`,
    );
  });

  return { close: () => server.close(), port };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  personas: Map<string, PersonaCtx>,
  _opts: DaemonOptions,
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = (req.method ?? "GET").toUpperCase();
  const path = url.pathname;

  if (method === "GET" && path === "/health") {
    return text(res, 200, "ok");
  }

  if (method === "GET" && path === "/personas") {
    return text(res, 200, [...personas.keys()].join("\n"));
  }

  // Multi-persona pattern: /personas/:slug/<rest>
  const multiMatch = path.match(/^\/personas\/([^/]+)(\/.*)?$/);
  if (multiMatch) {
    const slug = decodeURIComponent(multiMatch[1]!);
    const rest = multiMatch[2] ?? "/";
    const ctx = personas.get(slug);
    if (!ctx) return text(res, 404, `unknown persona: ${slug}`);
    return await handlePersona(req, res, ctx, method, rest);
  }

  // Single-persona pattern: routes apply to the one persona we loaded.
  if (personas.size === 1) {
    const ctx = [...personas.values()][0]!;
    return await handlePersona(req, res, ctx, method, path);
  }

  return text(res, 404, "not found");
}

async function handlePersona(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PersonaCtx,
  method: string,
  path: string,
) {
  if (method === "GET" && path === "/trust.md") {
    return text(res, 200, ctx.manifest.raw);
  }
  if (method === "GET" && path === "/history.log") {
    const logPath = join(ctx.trustDir, "history.log");
    if (!existsSync(logPath)) return text(res, 200, "");
    const buf = readFileSync(logPath, "utf8");
    // Truncate to last 64 KB to avoid massive responses.
    const tail = buf.length > 65536 ? buf.slice(-65536) : buf;
    return text(res, 200, tail);
  }

  if (method === "POST" && path === "/sessions") {
    const body = await readBody(req);
    const cfg: ResponderSessionConfig = {
      trustDir: ctx.trustDir,
      manifest: ctx.manifest,
      guardian: ctx.guardian,
    };
    const session = new ResponderSession(cfg);
    ctx.sessions.set(session.id, session);
    const result = await session.step(body);
    res.setHeader("x-session-id", session.id);
    res.setHeader("x-session-done", String(result.done));
    if (result.done) ctx.sessions.delete(session.id);
    return text(res, 200, result.outbound ?? "");
  }

  const turnMatch = path.match(/^\/sessions\/([^/]+)\/turn$/);
  if (method === "POST" && turnMatch) {
    const id = turnMatch[1]!;
    const session = ctx.sessions.get(id);
    if (!session) return text(res, 404, `unknown session: ${id}`);
    const body = await readBody(req);
    const result = await session.step(body);
    res.setHeader("x-session-id", id);
    res.setHeader("x-session-done", String(result.done));
    if (result.done) ctx.sessions.delete(id);
    return text(res, 200, result.outbound ?? "");
  }

  return text(res, 404, `not found: ${method} ${path}`);
}

function text(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---- Client helpers (used by CLI and tests) ----

export interface ClientOptions {
  baseUrl: string;
  /** When the daemon is multi-persona, slug of the responder; undefined for single. */
  slug?: string;
}

export interface ClientSession {
  id: string;
  postTurn(wire: string): Promise<{ outbound: string; done: boolean }>;
}

export async function startClientSession(
  opts: ClientOptions,
  openWire: string,
): Promise<{ session: ClientSession; firstReply: { outbound: string; done: boolean } }> {
  const url = opts.slug
    ? `${opts.baseUrl}/personas/${encodeURIComponent(opts.slug)}/sessions`
    : `${opts.baseUrl}/sessions`;
  const resp = await fetch(url, { method: "POST", body: openWire });
  if (!resp.ok) throw new Error(`session start failed: ${resp.status} ${await resp.text()}`);
  const id = resp.headers.get("x-session-id");
  const done = resp.headers.get("x-session-done") === "true";
  if (!id) throw new Error("no x-session-id header in response");
  const outbound = await resp.text();
  const session: ClientSession = {
    id,
    async postTurn(wire) {
      const turnUrl = opts.slug
        ? `${opts.baseUrl}/personas/${encodeURIComponent(opts.slug)}/sessions/${id}/turn`
        : `${opts.baseUrl}/sessions/${id}/turn`;
      const r = await fetch(turnUrl, { method: "POST", body: wire });
      if (!r.ok) throw new Error(`turn failed: ${r.status} ${await r.text()}`);
      const d = r.headers.get("x-session-done") === "true";
      return { outbound: await r.text(), done: d };
    },
  };
  return { session, firstReply: { outbound, done } };
}
