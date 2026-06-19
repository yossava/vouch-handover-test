import type { Thread } from "./reconcile.js";

export type Severity = "emergency" | "on_fire" | "flagged" | "pending" | "fyi";

export interface SeverityResult {
  severity: Severity;
  reason?: string;
}

// High-precision patterns for instructions aimed at the tool/system (prompt injection).
const MANIPULATION_PATTERNS: RegExp[] = [
  /\bignore (all|any|the|every|previous|prior|other)\b/i,
  /\bdisregard\b/i,
  /(system|admin) note to|instructions? to the (handover|system|tool|assistant|ai|model)/i,
  /report\b[^.]{0,40}\ball[\s-]?clear\b/i,
  /\bmark\b[^.]{0,20}\bapproved\b/i,
  /\boverride\b[^.]{0,20}\b(rule|instruction|system|policy)/i,
];

/** Deterministic: does the text try to instruct the tool/system? (Prompt injection.) */
export function detectManipulation(text: string): boolean {
  return MANIPULATION_PATTERNS.some((re) => re.test(text));
}

const EMERGENCY = /\bambulance\b|\bunwell\b|\bmedical\b|\binjur|\bfire\b|\bevacuat/i;
const ON_FIRE = /\bdeadline\b|48 hours|immigration|compliance|never collected|out of order|\bsafe\b|护照|保险箱/i;

/**
 * Deterministic severity for a thread — code owns severity (CLAUDE.md). Manipulation
 * is checked FIRST so an injected note is flagged for human review rather than acted
 * on, or escalated by its own (possibly fake) content.
 */
/**
 * Core deterministic severity for a piece of source text. `isOpen` selects the
 * non-keyword fallback (an open item is pending, otherwise fyi). Used for both
 * structured threads and model-enriched free-text blocks.
 */
export function severityForText(text: string, isOpen: boolean): SeverityResult {
  if (detectManipulation(text)) return { severity: "flagged", reason: "manipulation attempt in source text" };
  if (EMERGENCY.test(text)) return { severity: "emergency" };
  if (ON_FIRE.test(text)) return { severity: "on_fire" };
  return { severity: isOpen ? "pending" : "fyi" };
}

export function severityForThread(t: Thread): SeverityResult {
  const text = t.events.map((e) => e.text).join("\n");
  const base = severityForText(text, t.status === "still_open" || t.status === "new_tonight");
  // resolved tonight is informational unless it is itself a manipulation attempt.
  if (t.status === "newly_resolved" && base.severity !== "flagged") return { severity: "fyi" };
  return base;
}
