import { sortByTimestamp, type Event, type IngestResult } from "./ingest.js";

export type ThreadStatus =
  | "new_tonight" // first appeared on the target shift, still open
  | "still_open" // carried over from an earlier shift, not yet resolved
  | "newly_resolved" // was open, resolved on the target shift
  | "resolved_earlier"; // resolved on an EARLIER shift — excluded from the report

export interface Thread {
  key: string; // "room:112" | "guest:..." | "id:evt_0011"
  status: ThreadStatus;
  events: Event[]; // structured events (up to the target morning) + linked night-log blocks, sorted by ts
  firstShift: string | null; // morning of the earliest event in the thread
  lastShift: string | null; // morning of the latest event
  resolvedShift: string | null; // morning the thread was resolved, if resolved
}

export interface Reconciliation {
  targetMorning: string;
  threads: Thread[]; // classified threads (each has >=1 structured event up to the target)
  pendingBlocks: Event[]; // night-log blocks not linked to a structured thread — await the LLM layer
}

/**
 * Deterministically group events into issue threads and classify each relative to
 * a target morning (defaults to the most recent shift).
 *
 * Linking key is room -> guest -> id (singleton). Resolution is tracked from the
 * structured `status` over time — the LATEST structured state wins — so an item
 * resolved on an EARLIER shift is classified `resolved_earlier` and dropped from
 * the report, never re-summarised from scratch.
 *
 * Deliberately conservative; the LLM layer refines it later:
 *  - rooms are matched by field, else the first 3-digit token in the text;
 *  - free-text blocks with no structured counterpart are returned in `pendingBlocks`;
 *  - a thread reopened only by free text (e.g. the 205 in-house/empty contradiction)
 *    still reads as `resolved_earlier` here — the block is retained on the thread for
 *    the model to reopen.
 */
export function reconcile(ingestResult: IngestResult, targetMorning?: string): Reconciliation {
  const target = targetMorning ?? latestMorning(ingestResult.shifts);

  const shiftOf = new Map<string, string>();
  for (const shift of ingestResult.shifts) {
    for (const e of shift.events) shiftOf.set(e.id, shift.morningDate);
  }

  const groups = new Map<string, Event[]>();
  for (const e of [...ingestResult.events, ...ingestResult.logBlocks]) {
    const key = threadKey(e);
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }

  const threads: Thread[] = [];
  const pendingBlocks: Event[] = [];
  for (const [key, members] of groups) {
    const structured = members.filter(
      (e) => e.source === "events" && leq(shiftOf.get(e.id), target),
    );
    if (structured.length === 0) {
      // Nothing known about this group as of the target morning — leave any prose for the LLM.
      pendingBlocks.push(...members.filter((e) => e.source === "night-log"));
      continue;
    }
    const blocks = members.filter((e) => e.source === "night-log");
    threads.push(classify(key, structured, blocks, shiftOf, target));
  }

  threads.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { targetMorning: target, threads, pendingBlocks };
}

/** Threads to surface in the handover — everything except items resolved on an earlier shift. */
export function reportableThreads(r: Reconciliation): Thread[] {
  return r.threads.filter((t) => t.status !== "resolved_earlier");
}

function classify(
  key: string,
  structured: Event[],
  blocks: Event[],
  shiftOf: Map<string, string>,
  target: string,
): Thread {
  const ordered = sortByTimestamp(structured);
  const firstShift = shiftOf.get(ordered[0].id) ?? null;
  const latest = ordered[ordered.length - 1];
  const lastShift = shiftOf.get(latest.id) ?? null;

  const resolved = latest.status === "resolved";
  const resolvedShift = resolved ? lastShift : null;

  let status: ThreadStatus;
  if (resolved) {
    status = resolvedShift === target ? "newly_resolved" : "resolved_earlier";
  } else {
    status = firstShift === target ? "new_tonight" : "still_open";
  }

  return {
    key,
    status,
    events: sortByTimestamp([...structured, ...blocks]),
    firstShift,
    lastShift,
    resolvedShift,
  };
}

function threadKey(e: Event): string {
  const room = e.room ?? firstRoomInText(e.text);
  if (room) return `room:${room}`;
  if (e.guest) return `guest:${e.guest.trim().toLowerCase()}`;
  return `id:${e.id}`; // singleton; topic-level linking is left to the LLM layer
}

/** First room-like token: a standalone 3-digit number. Heuristic; the LLM refines it later. */
function firstRoomInText(text: string): string | null {
  const m = text.match(/\b\d{3}\b/);
  return m ? m[0] : null;
}

function latestMorning(shifts: IngestResult["shifts"]): string {
  if (shifts.length === 0) throw new Error("No shifts to reconcile");
  return shifts[shifts.length - 1].morningDate; // shifts are sorted ascending by morningDate
}

function leq(shift: string | undefined, target: string): boolean {
  return shift !== undefined && shift <= target; // ISO dates compare chronologically as strings
}
