import { describe, it, expect } from "vitest";
import { encode, decode, command, response } from "../../src/frame-command.js";

describe("encode/decode round-trip", () => {
  it("round-trips a simple command", () => {
    const original = {
      frame: "I need the 1099 from your records.",
      body: "cat ~/2025/1099-SA.pdf",
      bodyKind: "command" as const,
    };
    const wire = encode(original);
    const decoded = decode(wire);
    expect(decoded).toEqual(original);
  });

  it("round-trips a response", () => {
    const original = {
      frame: "Returning the form with account number redacted to last-4.",
      body: "Form 1099-SA — Tax Year 2025\nAccount: ****8421\nDistribution: $4,212.00",
      bodyKind: "response" as const,
    };
    const wire = encode(original);
    const decoded = decode(wire);
    expect(decoded).toEqual(original);
  });

  it("preserves multi-paragraph frame text", () => {
    const original = {
      frame: "I'm a tax-prep agent.\n\nI need 1099 forms for 2025.",
      body: "ls ~/2025",
      bodyKind: "command" as const,
    };
    const wire = encode(original);
    const decoded = decode(wire);
    expect(decoded.frame).toBe(original.frame);
  });
});

describe("decode error handling", () => {
  it("throws on missing delimiter", () => {
    expect(() => decode("FRAME: hi\nCOMMAND: ls")).toThrow(/delimiter/i);
  });

  it("v0.2 lenience: missing FRAME label uses entire pre-delimiter text as frame", () => {
    const m = decode("the intent\n---\nCOMMAND: ls");
    expect(m.frame).toBe("the intent");
    expect(m.body).toBe("ls");
    expect(m.bodyKind).toBe("command");
  });

  it("v0.2 lenience: missing body label defaults to bodyKind=command", () => {
    const m = decode("FRAME: hi\n---\njust some text");
    expect(m.frame).toBe("hi");
    expect(m.body).toBe("just some text");
    expect(m.bodyKind).toBe("command");
  });
});

describe("convenience helpers", () => {
  it("command() produces a decodable command turn", () => {
    const wire = command("the why", "the what");
    const decoded = decode(wire);
    expect(decoded.bodyKind).toBe("command");
    expect(decoded.frame).toBe("the why");
    expect(decoded.body).toBe("the what");
  });

  it("response() produces a decodable response turn", () => {
    const wire = response("here you go", "the data");
    const decoded = decode(wire);
    expect(decoded.bodyKind).toBe("response");
    expect(decoded.body).toBe("the data");
  });
});

describe("normalization", () => {
  it("normalizes \\r\\n line endings", () => {
    const wire = "FRAME: hi\r\n---\r\nCOMMAND: ls\r\n";
    const decoded = decode(wire);
    expect(decoded.frame).toBe("hi");
    expect(decoded.body).toBe("ls");
  });

  it("trims surrounding whitespace", () => {
    const wire = "\n\n  FRAME: hi\n---\nCOMMAND: ls  \n\n";
    const decoded = decode(wire);
    expect(decoded.frame).toBe("hi");
    expect(decoded.body).toBe("ls");
  });
});
