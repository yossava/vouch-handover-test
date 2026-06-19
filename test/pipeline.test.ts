import { describe, it, expect } from "vitest";
import { generateHandover } from "../src/pipeline";
import { loadSampleData } from "../src/data";

function capture() {
  const logs: Record<string, unknown>[] = [];
  const mk = (bound: object): ReturnType<typeof make> => make(bound);
  function make(bound: object) {
    return {
      info: (o: object, msg: string) => logs.push({ level: "info", msg, ...bound, ...o }),
      warn: (o: object, msg: string) => logs.push({ level: "warn", msg, ...bound, ...o }),
      error: (o: object, msg: string) => logs.push({ level: "error", msg, ...bound, ...o }),
      child: (b: object) => mk({ ...bound, ...b }),
    };
  }
  return { logger: make({}), logs };
}

describe("generateHandover — deterministic (no model)", () => {
  it("defaults as_of to the latest shift and logs each reconcile decision with hotel_id + as_of", async () => {
    const { logger, logs } = capture();
    const data = loadSampleData();
    const h = await generateHandover({ hotel: data.hotel, events: data.events, nightLogs: data.nightLogs }, { logger });

    expect(h.targetMorning).toBe("2026-05-30");
    const decisions = logs.filter((l) => l.msg === "reconcile.thread" || l.msg === "reconcile.suppressed");
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((l) => l.hotel_id === "lumen-sg" && l.as_of === "2026-05-30")).toBe(true);
    // the corridor leak is logged as suppressed (resolved on an earlier shift)
    expect(logs.some((l) => l.msg === "reconcile.suppressed" && l.thread === "room:215")).toBe(true);
  });

  it("is tolerant of events-only input", async () => {
    const { logger } = capture();
    const data = loadSampleData();
    const h = await generateHandover({ hotel: data.hotel, events: data.events }, { logger });
    expect(h.targetMorning).toBe("2026-05-30");
    expect(h.items.length).toBeGreaterThan(0);
  });

  it("is tolerant of nightLogs-only input (no structured shifts -> as_of null)", async () => {
    const { logger } = capture();
    const data = loadSampleData();
    const h = await generateHandover({ hotel: data.hotel, nightLogs: data.nightLogs }, { logger });
    expect(h.targetMorning).toBeNull();
    expect(h.items.length).toBeGreaterThan(0);
  });
});

describe("generateHandover — with a (fake) model", () => {
  it("logs a grounding.reject (which claim, why) when the model fabricates a quote", async () => {
    const { logger, logs } = capture();
    const data = loadSampleData();
    const fakeFabricator = async () =>
      JSON.stringify({
        entries: [
          {
            kind: "other",
            summary: "Invented item",
            claims: [{ text: "x", source_ids: ["log_0001"], evidence_quote: "a quote that appears in no source at all" }],
          },
        ],
      });

    await generateHandover({ hotel: data.hotel, nightLogs: data.nightLogs }, { logger, complete: fakeFabricator });

    expect(logs.some((l) => l.msg === "model.call")).toBe(true);
    expect(logs.some((l) => l.msg === "grounding.reject" && /evidence_quote not found/.test(String(l.reason)))).toBe(true);
  });
});
