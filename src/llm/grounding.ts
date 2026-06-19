import type { Entry } from "./schema.js";

export interface UngroundedEntry {
  entry: Entry;
  reasons: string[];
}

export interface GroundingResult {
  grounded: Entry[]; // passed both layers — safe to ship
  ungrounded: UngroundedEntry[]; // failed — kept for debugging, never shipped
}

/**
 * Two-layer grounding check (pure, deterministic). `sources` maps every source id
 * (evt_xxxx / log_xxxx) to its ORIGINAL-language text. An entry ships only if every
 * claim is grounded AND its summary introduces no unsourced entity.
 */
export function validateEntries(entries: Entry[], sources: Map<string, string>): GroundingResult {
  const grounded: Entry[] = [];
  const ungrounded: UngroundedEntry[] = [];
  for (const entry of entries) {
    const reasons = checkEntry(entry, sources);
    if (reasons.length === 0) grounded.push(entry);
    else ungrounded.push({ entry, reasons });
  }
  return { grounded, ungrounded };
}

function checkEntry(entry: Entry, sources: Map<string, string>): string[] {
  const reasons: string[] = [];

  // Layer 1: every claim's evidence_quote is a verbatim substring of a cited source.
  for (const claim of entry.claims) {
    const unknownId = claim.source_ids.find((id) => !sources.has(id));
    if (unknownId) {
      reasons.push(`claim cites unknown source ${unknownId}`);
      continue;
    }
    const grounded = claim.source_ids.some((id) => sources.get(id)!.includes(claim.evidence_quote));
    if (!grounded) {
      reasons.push(`evidence_quote not found in cited source: "${claim.evidence_quote}"`);
    }
  }
  // A translation's original_quote is itself an evidence quote — hold it to the same bar.
  if (entry.translation) {
    const ok = [...citedIds(entry)].some((id) =>
      sources.get(id)?.includes(entry.translation!.original_quote),
    );
    if (!ok) reasons.push("translation original_quote not found in cited sources");
  }

  // Layer 2: the summary may not introduce a room/amount/name absent from the cited sources.
  reasons.push(...summaryViolations(entry.summary, citedText(entry, sources)));

  return reasons;
}

function citedIds(entry: Entry): Set<string> {
  return new Set(entry.claims.flatMap((c) => c.source_ids));
}

function citedText(entry: Entry, sources: Map<string, string>): string {
  return [...citedIds(entry)].map((id) => sources.get(id) ?? "").join("\n");
}

/**
 * Layer 2: every >=2-digit number (room or money amount) and every Title-cased
 * multi-word name in the summary must appear in the cited sources. Number checks
 * are exact; name checks are case-insensitive (best-effort — flags invented person
 * names without tripping on case/hyphenation of domain phrases).
 */
export function summaryViolations(summary: string, sourceText: string): string[] {
  const violations: string[] = [];
  const src = sourceText.replace(/,/g, "");
  const srcLower = src.toLowerCase();

  const numbers = (summary.replace(/,/g, "").match(/\d{2,}/g) ?? []);
  for (const n of new Set(numbers)) {
    if (!new RegExp(`\\b${n}\\b`).test(src)) {
      violations.push(`summary introduces number not in sources: ${n}`);
    }
  }

  const names = summary.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) ?? [];
  for (const name of new Set(names)) {
    if (!srcLower.includes(name.toLowerCase())) {
      violations.push(`summary introduces name not in sources: ${name}`);
    }
  }

  return violations;
}
