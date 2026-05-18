// Wire-format encode/decode.
//
// Every turn on the wire is two halves of plain text, separated by a `---`
// line. The first half is the FRAME (intent in plain English). The second
// half is the COMMAND (outbound) or RESPONSE (inbound). No JSON envelope.
//
// Sample outbound turn:
//
//   FRAME: I'm a tax-prep agent helping Joe gather his 2025 1099s. I need
//   the HSA distribution form from your records.
//   ---
//   COMMAND: cat ~/2025/1099-SA.pdf
//
// Sample inbound turn:
//
//   FRAME: Honored. Returning the 1099-SA with account number redacted to
//   last-4, per my counter-offer rules.
//   ---
//   RESPONSE: Form 1099-SA — Tax Year 2025
//   Trustee: Optum Financial
//   Account: ****8421
//   Distribution: $4,212.00 (qualified medical)
//   ...

import type { WireMessage } from "./types.js";

const DELIM = "\n---\n";

/** Encode a wire message to its on-the-wire textual form. */
export function encode(msg: WireMessage): string {
  const bodyLabel = msg.bodyKind === "command" ? "COMMAND" : "RESPONSE";
  const frame = msg.frame.trim();
  const body = msg.body.trim();
  return `FRAME: ${frame}${DELIM}${bodyLabel}: ${body}\n`;
}

/** Decode an on-the-wire message back to its WireMessage form. */
export function decode(text: string): WireMessage {
  // Normalize line endings and trim.
  const normalized = text.replace(/\r\n/g, "\n").trim();

  // Find the delimiter.
  const idx = normalized.indexOf(DELIM.trim());
  if (idx === -1) {
    throw new Error("Wire message missing `---` delimiter between frame and body");
  }

  const before = normalized.slice(0, idx).trim();
  const after = normalized.slice(idx + DELIM.trim().length).trim();

  // FRAME label is optional — if the first half has no `FRAME:` prefix, the
  // entire first half IS the frame text. Lenient v0.2 behavior; v0.1 always
  // produced the labeled form, so this stays backward-compatible.
  const frameMatch = before.match(/^FRAME:\s*([\s\S]*)$/);
  const frame = (frameMatch ? frameMatch[1]! : before).trim();

  // Body label: explicit COMMAND or RESPONSE, OR raw body (defaults to
  // command — the daemon only ever receives commands from initiators).
  const cmdMatch = after.match(/^COMMAND:\s*([\s\S]*)$/);
  const respMatch = after.match(/^RESPONSE:\s*([\s\S]*)$/);
  if (cmdMatch) return { frame, body: cmdMatch[1]!.trim(), bodyKind: "command" };
  if (respMatch) return { frame, body: respMatch[1]!.trim(), bodyKind: "response" };
  return { frame, body: after, bodyKind: "command" };
}

/** Convenience helper: build an outbound command turn. */
export function command(frame: string, command: string): string {
  return encode({ frame, body: command, bodyKind: "command" });
}

/** Convenience helper: build an inbound response turn. */
export function response(frame: string, response: string): string {
  return encode({ frame, body: response, bodyKind: "response" });
}
