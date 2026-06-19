import { describe, it, expect } from "vitest";
import { loadSampleData } from "../src/data";
import { ingest } from "../src/ingest";
import { reconcile } from "../src/reconcile";
import { buildHandover, type Handover } from "../src/handover";

// Deterministic verification of the structured behaviours across three mornings.
// (The Chinese 208 free-text entry needs the model — verified in eval/mornings.ts.)
const data = loadSampleData();
const morning = (d: string): Handover => buildHandover(reconcile(ingest(data), d));
const find = (h: Handover, key: string) => h.items.find((i) => i.key === key);

describe("handover verification across mornings 28 / 29 / 30", () => {
  const h28 = morning("2026-05-28");
  const h29 = morning("2026-05-29");
  const h30 = morning("2026-05-30");

  it("112 aircon is still_open across all three mornings (cross-format thread)", () => {
    for (const h of [h28, h29, h30]) expect(find(h, "room:112")?.status).toBe("still_open");
  });

  it("the 2F leak (215) is newly_resolved on the 29th, then does not resurface on the 30th", () => {
    expect(find(h29, "room:215")?.status).toBe("newly_resolved");
    expect(h29.buckets.fyi.some((i) => i.key === "room:215")).toBe(true);
    expect(find(h30, "room:215")).toBeUndefined();
    expect(h30.suppressed).toContain("room:215");
  });

  it("the 309 deposit is on_fire (never collected before checkout) on the 30th", () => {
    expect(find(h30, "room:309")?.severity).toBe("on_fire");
  });

  it("the immigration 48h backlog (204) is on_fire on the 30th", () => {
    expect(find(h30, "room:204")?.severity).toBe("on_fire");
  });

  it("the 312 no-show is FLAGGED as contradictory, showing both sides", () => {
    const t = find(h30, "room:312");
    expect(t?.severity).toBe("flagged");
    expect(t?.flaggedReason).toMatch(/contradiction/);
    expect(t?.contradiction?.a).toBeTruthy();
    expect(t?.contradiction?.b).toMatch(/disputes/);
  });

  it("the 226 damage report is FLAGGED as INCOMPLETE (not charge-ready)", () => {
    const t = find(h30, "room:226");
    expect(t?.severity).toBe("flagged");
    expect(t?.flaggedReason).toMatch(/incomplete/i);
    expect(t?.flaggedReason).toMatch(/approval/i);
  });

  it("the evt_0026 injection note stays FLAGGED (manipulation) and is not obeyed", () => {
    const t = find(h30, "room:214");
    expect(t?.severity).toBe("flagged");
    expect(t?.flaggedReason).toMatch(/manipulation/);
    expect(h30.allClear).toBe(false);
  });

  it("items resolved on earlier shifts do not resurface", () => {
    for (const key of ["room:118", "room:215", "id:evt_0011"]) {
      expect(find(h30, key)).toBeUndefined();
      expect(h30.suppressed).toContain(key);
    }
  });
});
