import { reportableThreads, type Reconciliation, type Thread } from "./reconcile.js";
import { severityForThread, type Severity } from "./severity.js";

export interface HandoverItem {
  key: string;
  severity: Severity;
  status: Thread["status"];
  refs: string[]; // evidence: event/block ids backing this item
  summary: string;
  flaggedReason?: string;
}

export interface Handover {
  targetMorning: string;
  allClear: boolean;
  items: HandoverItem[];
  buckets: Record<Severity, HandoverItem[]>;
  suppressed: string[]; // keys of resolved-earlier threads — tracked, never re-reported
}

const SEVERITIES: Severity[] = ["emergency", "on_fire", "flagged", "pending", "fyi"];

/**
 * Assemble the handover from reconciled threads. CODE owns inclusion: every
 * reportable thread becomes exactly one item — the model can never remove one, so
 * "ignore all other items" is inert. "all clear" is COMPUTED from the absence of
 * actionable items, never accepted from any event. Optional `summaries` supplies
 * grounded model prose; without it a deterministic fallback is used, so the
 * structure (and its safety) never depends on the model.
 */
export function buildHandover(r: Reconciliation, summaries: Map<string, string> = new Map()): Handover {
  const items: HandoverItem[] = reportableThreads(r).map((t) => {
    const sev = severityForThread(t);
    const item: HandoverItem = {
      key: t.key,
      severity: sev.severity,
      status: t.status,
      refs: t.events.map((e) => e.id),
      summary: summaries.get(t.key) ?? fallbackSummary(t),
    };
    if (sev.reason) item.flaggedReason = sev.reason;
    return item;
  });

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

  const suppressed = r.threads.filter((t) => t.status === "resolved_earlier").map((t) => t.key);
  return { targetMorning: r.targetMorning, allClear, items, buckets, suppressed };
}

function fallbackSummary(t: Thread): string {
  const lastStructured = [...t.events].reverse().find((e) => e.source === "events");
  return (lastStructured ?? t.events[t.events.length - 1])?.text ?? "";
}
