import { describe, it, expect } from "vitest";
import { buildHandover } from "../src/handover";
import type { Reconciliation, Thread } from "../src/reconcile";

function thread(key: string, status: Thread["status"], text: string, id = "evt_a"): Thread {
  return {
    key,
    status,
    firstShift: "2026-05-30",
    lastShift: "2026-05-30",
    resolvedShift: status === "newly_resolved" ? "2026-05-30" : null,
    events: [{ id, ts: null, room: null, guest: null, type: null, text, source: "events", status: "pending" }],
  };
}
function recon(threads: Thread[]): Reconciliation {
  return { targetMorning: "2026-05-30", threads, pendingBlocks: [] };
}

describe("buildHandover", () => {
  it("buckets by severity and includes every reportable thread", () => {
    const h = buildHandover(
      recon([
        thread("room:112", "still_open", "Aircon out of order"),
        thread("room:226", "new_tonight", "Cracked basin, propose a charge"),
      ]),
    );
    expect(h.items).toHaveLength(2);
    expect(h.buckets.on_fire.map((i) => i.key)).toContain("room:112"); // "out of order"
    expect(h.buckets.pending.map((i) => i.key)).toContain("room:226");
  });

  it("computes allClear from the absence of actionable items (never from an event)", () => {
    const clear = buildHandover(recon([thread("room:108", "newly_resolved", "Check-in went fine")]));
    expect(clear.buckets.fyi).toHaveLength(1);
    expect(clear.allClear).toBe(true);

    const notClear = buildHandover(recon([thread("room:112", "still_open", "Aircon out of order")]));
    expect(notClear.allClear).toBe(false);
  });

  it("uses a grounded model summary when provided, else the deterministic fallback", () => {
    const t = thread("room:309", "still_open", "Deposit never collected");
    expect(buildHandover(recon([t])).items[0].summary).toBe("Deposit never collected");
    const withModel = buildHandover(recon([t]), new Map([["room:309", "Deposit outstanding before checkout."]]));
    expect(withModel.items[0].summary).toBe("Deposit outstanding before checkout.");
  });

  it("lists resolved-earlier threads as suppressed, not as items", () => {
    const h = buildHandover(
      recon([
        thread("room:215", "resolved_earlier", "Corridor leak fixed"),
        thread("room:112", "still_open", "Aircon out of order"),
      ]),
    );
    expect(h.suppressed).toContain("room:215");
    expect(h.items.some((i) => i.key === "room:215")).toBe(false);
  });
});
