import { describe, it, expect } from "vitest";
import {
  normalizeEvents,
  splitNightLog,
  sortByTimestamp,
  bucketIntoShifts,
  parseUtcOffset,
  ingest,
  type Event,
} from "../src/ingest";
import { loadSampleData } from "../src/data";

const TZ = 480; // +08:00 in minutes

function ev(id: string, ts: string | null): Event {
  return { id, ts, room: null, guest: null, type: null, text: id, source: "events" };
}

describe("sortByTimestamp", () => {
  it("orders events ascending by instant regardless of input order", () => {
    const sorted = sortByTimestamp([
      ev("c", "2026-05-30T00:45:00+08:00"),
      ev("a", "2026-05-29T02:15:00+08:00"),
      ev("b", "2026-05-29T23:40:00+08:00"),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = [ev("b", "2026-05-29T23:40:00+08:00"), ev("a", "2026-05-29T02:15:00+08:00")];
    sortByTimestamp(input);
    expect(input.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("sorts untimed (night-log) events last", () => {
    const block: Event = { id: "log_0001", ts: null, room: null, guest: null, type: null, text: "x", source: "night-log" };
    const sorted = sortByTimestamp([block, ev("evt", "2026-05-29T02:15:00+08:00")]);
    expect(sorted.map((e) => e.id)).toEqual(["evt", "log_0001"]);
  });

  it("breaks ties on equal timestamps deterministically by id", () => {
    const t = "2026-05-29T02:15:00+08:00";
    const sorted = sortByTimestamp([ev("evt_0009", t), ev("evt_0003", t), ev("evt_0007", t)]);
    expect(sorted.map((e) => e.id)).toEqual(["evt_0003", "evt_0007", "evt_0009"]);
  });
});

describe("bucketIntoShifts (23:00–07:00 across two dates, +08:00)", () => {
  it("groups a 23:xx event and the following 00:xx–06:xx into ONE shift keyed by the morning date", () => {
    const shifts = bucketIntoShifts(
      [ev("late", "2026-05-25T23:14:00+08:00"), ev("early", "2026-05-26T03:10:00+08:00")],
      TZ,
    );
    expect(shifts).toHaveLength(1);
    expect(shifts[0].morningDate).toBe("2026-05-26");
    expect(shifts[0].start).toBe("2026-05-25T23:00:00+08:00");
    expect(shifts[0].end).toBe("2026-05-26T07:00:00+08:00");
    expect(shifts[0].events.map((e) => e.id)).toEqual(["late", "early"]);
  });

  it("excludes daytime events (07:00–22:59)", () => {
    expect(bucketIntoShifts([ev("noon", "2026-05-26T15:00:00+08:00")], TZ)).toHaveLength(0);
  });

  it("skips untimed events", () => {
    const block: Event = { id: "log_0001", ts: null, room: null, guest: null, type: null, text: "x", source: "night-log" };
    expect(bucketIntoShifts([block], TZ)).toHaveLength(0);
  });

  it("rolls over month boundaries", () => {
    const shifts = bucketIntoShifts([ev("x", "2026-05-31T23:30:00+08:00")], TZ);
    expect(shifts[0].morningDate).toBe("2026-06-01");
    expect(shifts[0].start).toBe("2026-05-31T23:00:00+08:00");
    expect(shifts[0].end).toBe("2026-06-01T07:00:00+08:00");
  });
});

describe("parseUtcOffset", () => {
  it("parses signed HH:MM offsets and Z", () => {
    expect(parseUtcOffset("+08:00")).toBe(480);
    expect(parseUtcOffset("-05:30")).toBe(-330);
    expect(parseUtcOffset("Z")).toBe(0);
  });

  it("rejects unsupported formats (e.g. IANA names)", () => {
    expect(() => parseUtcOffset("Asia/Singapore")).toThrow();
  });
});

describe("normalizeEvents", () => {
  it("maps raw fields to the unified Event and drops status", () => {
    const [e] = normalizeEvents([
      {
        id: "evt_0001",
        timestamp: "2026-05-25T23:14:00+08:00",
        type: "check_in",
        room: "204",
        guest: "Tan Wei Ming",
        description: "Late check-in.",
        status: "resolved",
      },
    ]);
    expect(e).toEqual({
      id: "evt_0001",
      ts: "2026-05-25T23:14:00+08:00",
      room: "204",
      guest: "Tan Wei Ming",
      type: "check_in",
      text: "Late check-in.",
      source: "events",
    });
  });
});

describe("splitNightLog", () => {
  it("splits generically on blank lines into citable, verbatim blocks", () => {
    const md = "First paragraph.\n\n- Bullet one.\n\n- 第二条 with 中文.\n\n---\n\nLast note.";
    const blocks = splitNightLog(md);
    expect(blocks.map((b) => b.text)).toEqual([
      "First paragraph.",
      "- Bullet one.",
      "- 第二条 with 中文.",
      "Last note.",
    ]);
    expect(blocks.map((b) => b.id)).toEqual(["log_0001", "log_0002", "log_0003", "log_0004"]);
    expect(blocks.every((b) => b.source === "night-log" && b.ts === null && b.type === null)).toBe(true);
  });

  it("drops pure-separator blocks but keeps non-Latin content", () => {
    const blocks = splitNightLog("---\n\n保险箱打不开了\n\n***");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("保险箱打不开了");
  });

  it("preserves verbatim substrings even with CRLF line endings", () => {
    const src = "Intro line.\r\n\r\nMulti\r\nline block.\r\n\r\nEnd.";
    const blocks = splitNightLog(src);
    expect(blocks.map((b) => b.text)).toEqual(["Intro line.", "Multi\r\nline block.", "End."]);
    for (const b of blocks) expect(src.includes(b.text)).toBe(true);
  });
});

describe("ingest (integration over the committed sample)", () => {
  const result = ingest(loadSampleData());

  it("normalizes + sorts all 26 structured events ascending", () => {
    expect(result.events).toHaveLength(26);
    const ts = result.events.map((e) => Date.parse(e.ts!));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it("buckets into night shifts spanning two dates, with the system-down night empty", () => {
    const counts = Object.fromEntries(result.shifts.map((s) => [s.morningDate, s.events.length]));
    expect(counts).toEqual({
      "2026-05-26": 5,
      "2026-05-27": 7,
      "2026-05-29": 5,
      "2026-05-30": 9,
    });
    // night of 27→28 was logged as free text; no structured events bucket to it
    expect(result.shifts.some((s) => s.morningDate === "2026-05-28")).toBe(false);
  });

  it("keeps every night-log block as a verbatim substring of the source (grounding-safe)", () => {
    const { nightLogs } = loadSampleData();
    expect(result.logBlocks.length).toBeGreaterThan(0);
    for (const b of result.logBlocks) {
      expect(nightLogs.includes(b.text)).toBe(true);
    }
  });

  it("preserves the multilingual (Chinese) entries verbatim", () => {
    const joined = result.logBlocks.map((b) => b.text).join("\n");
    expect(joined).toContain("保险箱"); // 208 safe — Chinese
    expect(joined).toContain("no-show"); // 312 — mixed Chinese/English
  });
});
