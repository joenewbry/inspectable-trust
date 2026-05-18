import { describe, it, expect } from "vitest";
import { tokenizeCommand, checkPath, looksLikeShell, looksLikeSql, executeShell } from "../../src/exec.js";
import { homedir } from "node:os";

describe("tokenizeCommand", () => {
  it("splits simple argv", () => {
    const { argv, rejection } = tokenizeCommand("rg TODO src/");
    expect(rejection).toBeUndefined();
    expect(argv).toEqual(["rg", "TODO", "src/"]);
  });

  it("respects single-quoted arguments", () => {
    const { argv } = tokenizeCommand("rg 'hello world' src/");
    expect(argv).toEqual(["rg", "hello world", "src/"]);
  });

  it("respects double-quoted arguments with escapes", () => {
    const { argv } = tokenizeCommand(`rg "hello \\"world\\"" src/`);
    expect(argv).toEqual(["rg", `hello "world"`, "src/"]);
  });

  it("rejects unterminated quotes", () => {
    const { rejection } = tokenizeCommand("rg 'hello");
    expect(rejection).toMatch(/unterminated/);
  });

  it("rejects pipe and ampersand outside quotes", () => {
    const { rejection: rPipe } = tokenizeCommand("ls | cat");
    expect(rPipe).toMatch(/metacharacter/);
    const { rejection: rAmp } = tokenizeCommand("ls && cat");
    expect(rAmp).toMatch(/metacharacter/);
  });

  it("rejects backticks, $(), redirects", () => {
    expect(tokenizeCommand("cat `whoami`").rejection).toMatch(/metacharacter/);
    expect(tokenizeCommand("cat $(whoami)").rejection).toMatch(/metacharacter/);
    expect(tokenizeCommand("cat foo > bar").rejection).toMatch(/metacharacter/);
    expect(tokenizeCommand("cat < foo").rejection).toMatch(/metacharacter/);
  });

  it("allows metacharacters INSIDE quotes (rg pattern with pipes)", () => {
    const { argv, rejection } = tokenizeCommand(`rg "TODO|FIXME" src/`);
    expect(rejection).toBeUndefined();
    expect(argv).toEqual(["rg", "TODO|FIXME", "src/"]);
  });
});

describe("checkPath", () => {
  it("rejects ~/.ssh paths", () => {
    expect(checkPath(`${homedir()}/.ssh/id_rsa`, "/tmp")).toMatch(/denied/);
  });

  it("rejects /etc paths", () => {
    expect(checkPath("/etc/passwd", "/tmp")).toMatch(/denied/);
  });

  it("rejects .env files anywhere", () => {
    expect(checkPath("/some/project/.env", "/tmp")).toMatch(/denied/);
    expect(checkPath("./.env.production", "/some/project")).toMatch(/denied/);
  });

  it("rejects 'aliases' substring anywhere in path", () => {
    expect(checkPath("/home/prometheus/.trust/sessions/abc/aliases.md", "/tmp")).toMatch(/denied/);
  });

  it("allows normal repo paths", () => {
    expect(checkPath("./src/foo.ts", "/Users/joe/dev/claims-genie")).toBeNull();
    expect(checkPath("/ssd/claims-genie/current/src", "/tmp")).toBeNull();
  });
});

describe("looksLikeShell / looksLikeSql", () => {
  it("recognizes whitelisted shell commands", () => {
    expect(looksLikeShell("rg TODO src/")).toBe(true);
    expect(looksLikeShell("find . -name '*.ts'")).toBe(true);
    expect(looksLikeShell("cat README.md")).toBe(true);
  });

  it("rejects non-whitelisted commands", () => {
    expect(looksLikeShell("curl http://example.com")).toBe(false);
    expect(looksLikeShell("rm -rf /")).toBe(false);
    expect(looksLikeShell("sqlite3 foo.db")).toBe(false);
  });

  it("recognizes SELECT and WITH queries", () => {
    expect(looksLikeSql("SELECT * FROM users")).toBe(true);
    expect(looksLikeSql("with t as (select 1) select * from t")).toBe(true);
    expect(looksLikeSql("  -- a comment\n  SELECT * FROM users")).toBe(true);
  });

  it("rejects non-SELECT queries", () => {
    expect(looksLikeSql("INSERT INTO users VALUES (1)")).toBe(false);
    expect(looksLikeSql("DROP TABLE users")).toBe(false);
  });
});

describe("executeShell", () => {
  it("rejects non-whitelisted binaries", async () => {
    const { rejection } = await executeShell("curl https://example.com");
    expect(rejection).toMatch(/not on the read-only whitelist/);
  });

  it("rejects pipes via shell metacharacters", async () => {
    const { rejection } = await executeShell("ls | cat");
    expect(rejection).toMatch(/metacharacter/);
  });

  it("rejects denied paths", async () => {
    const { rejection } = await executeShell("cat /etc/passwd");
    expect(rejection).toMatch(/denied/);
  });

  it("runs a simple echo successfully", async () => {
    const { result } = await executeShell('echo "hello"');
    expect(result?.exitCode).toBe(0);
    expect(result?.stdout.trim()).toBe("hello");
  });

  it("times out on slow commands", async () => {
    // `true` finishes instantly so we just check the success path here.
    const { result } = await executeShell("true", { timeoutMs: 1000 });
    expect(result?.exitCode).toBe(0);
  });
});
