import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findIdentityRoot, findIdentityChain } from "../../src/identity.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "trust-identity-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findIdentityRoot", () => {
  it("finds a .trust/ in the start directory", () => {
    const id = join(root, "joe");
    mkdirSync(join(id, ".trust"), { recursive: true });

    const result = findIdentityRoot(id);
    expect(result).not.toBeNull();
    expect(result!.identityDir).toBe(id);
    expect(result!.trustDir).toBe(join(id, ".trust"));
    expect(result!.slug).toBe("joe");
  });

  it("walks up multiple levels to find a .trust/", () => {
    const id = join(root, "stanford-healthcare");
    mkdirSync(join(id, ".trust"), { recursive: true });
    mkdirSync(join(id, "billing", "2025"), { recursive: true });

    const result = findIdentityRoot(join(id, "billing", "2025"));
    expect(result).not.toBeNull();
    expect(result!.identityDir).toBe(id);
    expect(result!.slug).toBe("stanford-healthcare");
  });

  it("returns null when no .trust/ exists in any ancestor", () => {
    const result = findIdentityRoot(root);
    // tmpdir itself almost certainly has no .trust/ in any ancestor up to /.
    expect(result).toBeNull();
  });

  it("prefers the closest ancestor when nested", () => {
    // outer/.trust/ AND outer/inner/.trust/ — query from outer/inner/sub should pick inner
    const outer = join(root, "outer");
    const inner = join(outer, "inner");
    const sub = join(inner, "sub");
    mkdirSync(join(outer, ".trust"), { recursive: true });
    mkdirSync(join(inner, ".trust"), { recursive: true });
    mkdirSync(sub, { recursive: true });

    const result = findIdentityRoot(sub);
    expect(result).not.toBeNull();
    expect(result!.slug).toBe("inner");
  });
});

describe("findIdentityChain", () => {
  it("returns all .trust/ ancestors, closest first", () => {
    const outer = join(root, "outer");
    const inner = join(outer, "inner");
    mkdirSync(join(outer, ".trust"), { recursive: true });
    mkdirSync(join(inner, ".trust"), { recursive: true });
    mkdirSync(inner, { recursive: true });

    const chain = findIdentityChain(inner);
    expect(chain.map((c) => c.slug)).toEqual(["inner", "outer"]);
  });

  it("returns empty array when no .trust/ anywhere", () => {
    const chain = findIdentityChain(root);
    expect(chain).toEqual([]);
  });
});
