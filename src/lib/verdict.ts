import type { Verdict } from "./types";

const VERDICT_RE = /\n*\s*\**VERDICT:?\**\s*(go|think|skip)\b.*$/im;
const PARTIAL_VERDICT_RE = /(^|\n)\s*\**V(E(R(D(I(C(T(:\**\s*[a-z]*)?)?)?)?)?)?)?$/;

/** Splits Stash's reply into display text and verdict. While streaming, also hides a half-written "VERDICT" line. */
export function splitVerdict(text: string, streaming = false): { text: string; verdict?: Verdict } {
  const m = text.match(VERDICT_RE);
  if (m) return { text: text.replace(VERDICT_RE, "").trimEnd(), verdict: m[1].toLowerCase() as Verdict };
  return { text: streaming ? text.replace(PARTIAL_VERDICT_RE, "").trimEnd() : text.trimEnd() };
}
