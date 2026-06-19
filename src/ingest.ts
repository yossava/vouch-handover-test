import type { Hotel, FrontDeskEvent, SampleData } from "./data.js";

export type EventSource = "events" | "night-log";

/**
 * One normalized event from either input format. Deliberately minimal: kind,
 * severity, and grounding are decided downstream (model + code, see CLAUDE.md),
 * not baked in here.
 */
export interface Event {
  id: string;
  ts: string | null; // ISO 8601 w/ offset for structured events; null for night-log blocks
  room: string | null;
  guest: string | null;
  type: string | null; // structured event type; null until the model classifies a block
  text: string; // description (structured) | verbatim original-language block (night-log)
  source: EventSource;
}

/** A night shift (23:00–07:00, spanning two dates), keyed by the morning it ends. */
export interface Shift {
  morningDate: string; // "YYYY-MM-DD" — the date the shift ends
  start: string; // local ISO, 23:00 the previous date
  end: string; // local ISO, 07:00 the morning date
  events: Event[]; // structured events in this shift, sorted by ts
}

export interface IngestResult {
  hotel: Hotel;
  events: Event[]; // structured events, normalized + sorted by ts
  shifts: Shift[]; // night-shift buckets of the structured events
  logBlocks: Event[]; // night-log coarse blocks (verbatim, untimed)
}

/** Map raw structured events to the unified Event shape. Preserves input order. */
export function normalizeEvents(raw: FrontDeskEvent[]): Event[] {
  return raw.map((e): Event => ({
    id: e.id,
    ts: e.timestamp,
    room: e.room,
    guest: e.guest,
    type: e.type,
    text: e.description,
    source: "events",
  }));
}

/**
 * Split a free-text night-log into coarse paragraph blocks. Generic on purpose:
 * it splits on blank lines only — no sample-specific bullet/heading patterns — so
 * it holds for unseen prose. Each block keeps its verbatim original-language text
 * and a citable id; fine-grained segmentation + translation happen in the LLM layer.
 */
export function splitNightLog(markdown: string): Event[] {
  const blocks = markdown
    .split(/\r?\n\s*\r?\n/) // blank-line split, CRLF-safe; no text mutation so blocks stay verbatim
    .map((b) => b.trim())
    .filter((b) => /[\p{L}\p{N}]/u.test(b)); // drop blank / pure-separator blocks, keep any script
  return blocks.map((text, i): Event => ({
    id: `log_${String(i + 1).padStart(4, "0")}`,
    ts: null,
    room: null,
    guest: null,
    type: null,
    text,
    source: "night-log",
  }));
}

/**
 * Stable ascending sort by instant. Untimed events (night-log blocks) sort last;
 * ties break by id for determinism. Pure — does not mutate the input.
 */
export function sortByTimestamp(events: Event[]): Event[] {
  return [...events].sort((a, b) => {
    const ta = a.ts ? Date.parse(a.ts) : Infinity;
    const tb = b.ts ? Date.parse(b.ts) : Infinity;
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Bucket timestamped events into night shifts (23:00–07:00, spanning two dates),
 * keyed by the morning date the shift ends. Untimed and daytime (07:00–22:59)
 * events are skipped.
 */
export function bucketIntoShifts(events: Event[], utcOffsetMinutes: number): Shift[] {
  const byMorning = new Map<string, Event[]>();
  for (const ev of events) {
    if (!ev.ts) continue;
    const morningDate = shiftMorningDate(ev.ts, utcOffsetMinutes);
    if (!morningDate) continue; // daytime event, outside any night shift
    const bucket = byMorning.get(morningDate);
    if (bucket) bucket.push(ev);
    else byMorning.set(morningDate, [ev]);
  }
  return [...byMorning.entries()]
    .map(([morningDate, evs]): Shift => ({
      morningDate,
      start: localIso(addDays(morningDate, -1), 23, utcOffsetMinutes),
      end: localIso(morningDate, 7, utcOffsetMinutes),
      events: sortByTimestamp(evs),
    }))
    .sort((a, b) => (a.morningDate < b.morningDate ? -1 : a.morningDate > b.morningDate ? 1 : 0));
}

/**
 * Deterministic ingest: normalize + sort the structured events, bucket them into
 * night shifts, and split the night-log into citable verbatim blocks.
 */
export function ingest(data: SampleData): IngestResult {
  const offset = parseUtcOffset(data.hotel.timezone);
  const events = sortByTimestamp(normalizeEvents(data.events));
  return {
    hotel: data.hotel,
    events,
    shifts: bucketIntoShifts(events, offset),
    logBlocks: splitNightLog(data.nightLogs),
  };
}

// --- time helpers (fixed UTC offsets; no DST, matching the data) ---

/** Parse a fixed UTC offset like "+08:00" / "-05:30" / "Z" into minutes. */
export function parseUtcOffset(tz: string): number {
  if (tz === "Z") return 0;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
  if (!m) throw new Error(`Unsupported timezone offset: ${tz}`);
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Morning date (YYYY-MM-DD) of the night shift a timestamp falls in, or null if daytime. */
function shiftMorningDate(ts: string, offsetMin: number): string | null {
  const local = new Date(Date.parse(ts) + offsetMin * 60_000);
  const hour = local.getUTCHours();
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const d = local.getUTCDate();
  if (hour >= 23) return ymd(new Date(Date.UTC(y, mo, d + 1))); // 23:00–23:59 → next morning
  if (hour < 7) return ymd(new Date(Date.UTC(y, mo, d))); // 00:00–06:59 → this morning
  return null; // 07:00–22:59 → daytime, outside any night shift
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return ymd(new Date(Date.UTC(y, m - 1, d + n)));
}

function localIso(dateStr: string, hour: number, offsetMin: number): string {
  return `${dateStr}T${pad(hour)}:00:00${formatOffset(offsetMin)}`;
}

function formatOffset(offsetMin: number): string {
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function ymd(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
