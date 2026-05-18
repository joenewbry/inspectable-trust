import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { sealSession, unsealSession, checkAgeAvailable, readPrimaryRecipient } from "../../src/seal.js";

let ageAvailable = false;

beforeAll(async () => {
  ageAvailable = await checkAgeAvailable();
});

describe("seal / unseal roundtrip", () => {
  let dir: string;

  function makeTmp() {
    dir = join(tmpdir(), `trust-seal-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true });
  });

  it("checkAgeAvailable returns boolean", async () => {
    const av = await checkAgeAvailable();
    expect(typeof av).toBe("boolean");
  });

  it("readPrimaryRecipient picks the first age1 line, ignores comments", () => {
    const d = makeTmp();
    const recipients = join(d, "recipients.txt");
    writeFileSync(recipients, "# header comment\nage1xyz...\nage1another\n", "utf8");
    expect(readPrimaryRecipient(recipients)).toBe("age1xyz...");
  });

  it("sealSession is a no-op when aliases.md does not exist", async () => {
    const d = makeTmp();
    const recipients = join(d, "recipients.txt");
    writeFileSync(recipients, "age1example\n", "utf8");
    const result = await sealSession({
      aliasesPath: join(d, "missing.md"),
      auditRoot: join(d, "audit"),
      recipientsPath: recipients,
      sessionId: "no-aliases",
    });
    expect(result).toBeNull();
  });

  it.skipIf(!ageAvailable)(
    "encrypts aliases.md, deletes plaintext, and round-trips via unseal",
    async () => {
      const d = makeTmp();
      // Generate a fresh keypair for the test using the age binary.
      const keygen = spawnSync("age-keygen", { encoding: "utf8" });
      expect(keygen.status).toBe(0);
      const identityPath = join(d, "identity.txt");
      writeFileSync(identityPath, keygen.stdout, { mode: 0o400 });
      const pub = keygen.stderr
        .split("\n")
        .find((l) => l.includes("Public key"))
        ?.split(":")[1]
        ?.trim();
      expect(pub).toBeTruthy();
      const recipientsPath = join(d, "recipients.txt");
      writeFileSync(recipientsPath, pub + "\n");

      const aliasesPath = join(d, "aliases.md");
      const plaintext = "# Session foo — alias map\n| jane@x.com | marco@y.org | turn 1 |\n";
      writeFileSync(aliasesPath, plaintext, { mode: 0o600 });

      const result = await sealSession({
        aliasesPath,
        auditRoot: join(d, "audit"),
        recipientsPath,
        sessionId: "session-foo",
      });
      expect(result).not.toBeNull();
      expect(existsSync(result!.sealedPath)).toBe(true);
      expect(existsSync(aliasesPath)).toBe(false);
      expect(result!.bytesEncrypted).toBe(plaintext.length);

      // Sealed file should NOT contain the plaintext PII.
      const sealedBytes = readFileSync(result!.sealedPath);
      expect(sealedBytes.toString("utf8")).not.toContain("jane@x.com");

      // Roundtrip via unseal.
      const recovered = await unsealSession({
        sealedPath: result!.sealedPath,
        identityPath,
      });
      expect(recovered).toContain("jane@x.com");
      expect(recovered).toContain("marco@y.org");
    },
  );
});
