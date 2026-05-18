import { describe, it, expect } from "vitest";
import { ProdDb, formatRows } from "../../src/prod-db.js";

describe("ProdDb.rejectIfNotReadOnly", () => {
  it("accepts SELECT", () => {
    expect(ProdDb.rejectIfNotReadOnly("SELECT * FROM users")).toBeNull();
  });

  it("accepts WITH", () => {
    expect(ProdDb.rejectIfNotReadOnly("WITH t AS (SELECT 1) SELECT * FROM t")).toBeNull();
  });

  it("accepts whitelisted PRAGMA inspection", () => {
    expect(ProdDb.rejectIfNotReadOnly("PRAGMA table_info(users)")).toBeNull();
    expect(ProdDb.rejectIfNotReadOnly("PRAGMA table_list")).toBeNull();
  });

  it("rejects INSERT / UPDATE / DELETE / DROP", () => {
    expect(ProdDb.rejectIfNotReadOnly("INSERT INTO users VALUES (1)")).toMatch(/only SELECT/);
    expect(ProdDb.rejectIfNotReadOnly("UPDATE users SET email='x'")).toMatch(/only SELECT/);
    expect(ProdDb.rejectIfNotReadOnly("DELETE FROM users")).toMatch(/only SELECT/);
    expect(ProdDb.rejectIfNotReadOnly("DROP TABLE users")).toMatch(/only SELECT/);
  });

  it("rejects mutation PRAGMAs", () => {
    expect(ProdDb.rejectIfNotReadOnly("PRAGMA writable_schema = 1")).toMatch(/read-only inspection/);
  });

  it("rejects ATTACH", () => {
    expect(ProdDb.rejectIfNotReadOnly("SELECT * FROM users; ATTACH DATABASE 'evil' AS e")).toMatch(/ATTACH/);
  });

  it("strips leading comments before checking", () => {
    expect(
      ProdDb.rejectIfNotReadOnly("-- get all users\nSELECT * FROM users"),
    ).toBeNull();
    expect(ProdDb.rejectIfNotReadOnly("/* hi */ SELECT 1")).toBeNull();
  });

  it("rejects comments-only", () => {
    expect(ProdDb.rejectIfNotReadOnly("-- nothing")).toMatch(/only comments/);
  });
});

describe("formatRows", () => {
  it("returns (0 rows) for empty", () => {
    expect(formatRows([])).toBe("(0 rows)");
  });

  it("renders a header + tab-separated rows", () => {
    const out = formatRows([
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ]);
    expect(out.split("\n")[0]).toBe("id\tname");
    expect(out.split("\n")[1]).toBe("1\talice");
  });

  it("truncates above maxRows", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const out = formatRows(rows, 3);
    expect(out).toMatch(/truncated, 7 more rows/);
  });

  it("escapes tabs and newlines in cells", () => {
    const out = formatRows([{ note: "a\tb\nc" }]);
    expect(out).toMatch(/a b c/);
  });

  it("handles null cells", () => {
    const out = formatRows([{ name: null, age: 5 }]);
    expect(out.split("\n")[1]).toBe("\t5");
  });
});
