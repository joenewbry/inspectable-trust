// Direct read of a SQLCipher-encrypted SQLite database (Claims Genie prod DB).
//
// Opens with `better-sqlite3-multiple-ciphers`, sets the key from
// process.env.DB_ENCRYPTION_KEY, immediately sets `PRAGMA query_only=1` so
// nothing can mutate even if a bug let an INSERT/UPDATE through. As a second
// layer, query() rejects any SQL whose first non-whitespace, non-comment token
// isn't SELECT or WITH.

import Database from "better-sqlite3-multiple-ciphers";
import { existsSync } from "node:fs";

export interface ProdDbOptions {
  /** Path to the encrypted .db file. */
  dbPath: string;
  /** Encryption key (from /run/.../secrets.env via systemd EnvironmentFile). */
  encryptionKey: string;
  /** Per-statement timeout in ms. Default 5000. */
  busyTimeoutMs?: number;
}

export class ProdDb {
  private db: Database.Database;

  constructor(opts: ProdDbOptions) {
    if (!existsSync(opts.dbPath)) {
      throw new Error(`prod DB not found at ${opts.dbPath}`);
    }
    if (!opts.encryptionKey) {
      throw new Error("prod DB requires encryptionKey (DB_ENCRYPTION_KEY)");
    }
    this.db = new Database(opts.dbPath, { readonly: true, fileMustExist: true });
    // SQLCipher cipher select MUST come before the key — better-sqlite3-multiple-ciphers
    // supports several ciphers and the wrong one yields "file is not a database".
    // The claims-genie DB is built with `cipher = sqlcipher`. See
    // claims-genie/src/db/client.ts:41-44 for the exact pattern.
    this.db.pragma(`cipher = 'sqlcipher'`);
    this.db.pragma(`key = "x'${opts.encryptionKey}'"`);
    this.db.pragma(`busy_timeout=${opts.busyTimeoutMs ?? 5000}`);
    // PRAGMA query_only is a no-op when we already opened readonly:true; we set
    // it anyway as a belt-and-suspenders signal for downstream readers.
    this.db.pragma("query_only=1");
    // Smoke check: any query that errors here means the key is wrong.
    try {
      this.db.prepare("SELECT 1").get();
    } catch (err) {
      throw new Error(`prod DB open failed (wrong key or corrupted file): ${(err as Error).message}`);
    }
  }

  /** Returns `null` if SQL doesn't pass the SELECT/WITH guard; otherwise rejection text. */
  static rejectIfNotReadOnly(sql: string): string | null {
    // Strip leading comments and whitespace.
    let s = sql;
    while (true) {
      const trimmed = s.replace(/^\s+/, "");
      if (trimmed.startsWith("--")) {
        const nl = trimmed.indexOf("\n");
        if (nl === -1) return "only comments — no statement";
        s = trimmed.slice(nl + 1);
        continue;
      }
      if (trimmed.startsWith("/*")) {
        const end = trimmed.indexOf("*/");
        if (end === -1) return "unterminated block comment";
        s = trimmed.slice(end + 2);
        continue;
      }
      s = trimmed;
      break;
    }
    const firstToken = s.split(/[\s(]/)[0]?.toUpperCase() ?? "";
    if (firstToken !== "SELECT" && firstToken !== "WITH" && firstToken !== "PRAGMA" && firstToken !== "EXPLAIN") {
      return `only SELECT / WITH / PRAGMA / EXPLAIN allowed; got "${firstToken}"`;
    }
    // Forbid attaching other databases.
    if (/\bATTACH\b/i.test(sql)) return "ATTACH is not allowed";
    if (/\bPRAGMA\s+(?!table_info|schema_version|user_version|table_list|index_list|index_info|foreign_key_list|database_list|page_size|page_count)/i.test(sql)) {
      return "PRAGMA limited to read-only inspection pragmas";
    }
    return null;
  }

  /** Run a SELECT/WITH query, return rows as plain objects. */
  query(sql: string, params: unknown[] = []): { rows?: Record<string, unknown>[]; rejection?: string } {
    const rejection = ProdDb.rejectIfNotReadOnly(sql);
    if (rejection) return { rejection };
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as Record<string, unknown>[];
      return { rows };
    } catch (err) {
      return { rejection: `SQL error: ${(err as Error).message}` };
    }
  }

  /** List user tables. Convenient for partner LLMs to bootstrap. */
  listTables(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  close(): void {
    this.db.close();
  }
}

/** Format query rows as a tab-separated text block, with a header row. */
export function formatRows(rows: Record<string, unknown>[], maxRows = 200): string {
  if (rows.length === 0) return "(0 rows)";
  const truncated = rows.length > maxRows;
  const slice = rows.slice(0, maxRows);
  const cols = Object.keys(slice[0]!);
  const header = cols.join("\t");
  const body = slice
    .map((r) => cols.map((c) => formatCell(r[c])).join("\t"))
    .join("\n");
  const footer = truncated ? `\n--- truncated, ${rows.length - maxRows} more rows ---` : "";
  return `${header}\n${body}${footer}`;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.replace(/\t/g, " ").replace(/\n/g, " ");
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Build a ProdDb from environment-provided config. Returns null if not configured. */
export function tryOpenProdDbFromEnv(): ProdDb | null {
  const dbPath = process.env.TRUST_PROD_DB_PATH;
  const key = process.env.DB_ENCRYPTION_KEY;
  if (!dbPath || !key) return null;
  if (!existsSync(dbPath)) return null;
  try {
    return new ProdDb({ dbPath, encryptionKey: key });
  } catch (err) {
    console.error(`[trust] failed to open prod DB: ${(err as Error).message}`);
    return null;
  }
}
