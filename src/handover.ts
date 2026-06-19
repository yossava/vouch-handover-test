import { reportableThreads, type Reconciliation, type Thread } from "./reconcile.js";
import { severityForThread, type Severity } from "./severity.js";

export interface HandoverItem {
  key: string;
  severity: Severity;
  status: Thread["status"];
  refs: string[]; // evidence: event/block ids backing this item
  summary: string;
  flaggedReason?: string;
  since?: string | null; // morning the item first appeared — for "OPEN since <date>"
  contradiction?: { a: string; b: string }; // two conflicting statements, surfaced in the flagged view
}

export interface Handover {
  targetMorning: string | null;
  allClear: boolean;
  items: HandoverItem[];
  buckets: Record<Severity, HandoverItem[]>;
  suppressed: string[]; // keys of resolved-earlier threads — tracked, never re-reported
}

const SEVERITIES: Severity[] = ["emergency", "on_fire", "flagged", "pending", "fyi"];

/** One reportable thread -> one item (deterministic summary unless a grounded one is supplied). */
export function threadToItem(t: Thread, summaries: Map<string, string>): HandoverItem {
  const sev = severityForThread(t);
  const item: HandoverItem = {
    key: t.key,
    severity: sev.severity,
    status: t.status,
    refs: t.events.map((e) => e.id),
    summary: summaries.get(t.key) ?? fallbackSummary(t),
    since: t.firstShift,
  };
  if (sev.reason) item.flaggedReason = sev.reason;
  return item;
}

/**
 * Bucket items by severity and compute the handover. "all clear" is COMPUTED from
 * the absence of actionable items (emergency/on_fire/flagged/pending), never taken
 * from an event.
 */
export function assemble(targetMorning: string | null, items: HandoverItem[], suppressed: string[]): Handover {
  const buckets = Object.fromEntries(SEVERITIES.map((s) => [s, [] as HandoverItem[]])) as Record<
    Severity,
    HandoverItem[]
  >;
  for (const item of items) buckets[item.severity].push(item);

  const allClear =
    buckets.emergency.length === 0 &&
    buckets.on_fire.length === 0 &&
    buckets.flagged.length === 0 &&
    buckets.pending.length === 0;

  return { targetMorning, allClear, items, buckets, suppressed };
}

/**
 * Assemble a handover from reconciled threads only. CODE owns inclusion: every
 * reportable thread becomes exactly one item. (The pipeline layers model-enriched
 * free-text blocks on top via `assemble`.)
 */
export function buildHandover(r: Reconciliation, summaries: Map<string, string> = new Map()): Handover {
  const items = reportableThreads(r).map((t) => threadToItem(t, summaries));
  const suppressed = r.threads.filter((t) => t.status === "resolved_earlier").map((t) => t.key);
  return assemble(r.targetMorning, items, suppressed);
}

function fallbackSummary(t: Thread): string {
  const lastStructured = [...t.events].reverse().find((e) => e.source === "events");
  return (lastStructured ?? t.events[t.events.length - 1])?.text ?? "";
}
