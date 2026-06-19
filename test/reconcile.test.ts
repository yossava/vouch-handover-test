import { describe, it, expect } from "vitest";
import { ingest } from "../src/ingest";
import { loadSampleData } from "../src/data";
import { reconcile, reportableThreads } from "../src/reconcile";

const ing = ingest(loadSampleData());

describe("reconcile — threading", () => {
  it("links the room-112 aircon thread across the JSON and the free-text log", () => {
    const r = reconcile(ing);
    const t = r.threads.find((x) => x.key === "room:112");
    expect(t).toBeDefined();
    const ids = t!.events.map((e) => e.id);
    expect(ids).toContain("evt_0002"); // structured, opened on the 26th
    expect(ids).toContain("evt_0018"); // structured, updated on the 30th
    expect(t!.events.some((e) => e.source === "night-log")).toBe(true); // free-text bridge
  });

  it("keys by id when no room or guest is present (walk-in singleton)", () => {
    const r = reconcile(ing);
    expect(r.threads.find((t) => t.key === "id:evt_0011")).toBeDefined();
  });

  it("leaves unlinked free-text blocks pending for the LLM layer", () => {
    const r = reconcile(ing);
    expect(r.pendingBlocks.length).toBeGreaterThan(0);
    expect(r.pendingBlocks.every((b) => b.source === "night-log")).toBe(true);
    expect(r.pendingBlocks.some((b) => b.text.includes("保险箱"))).toBe(true); // 208 safe — prose only
  });
});

describe("reconcile — classification for morning 2026-05-30", () => {
  const r = reconcile(ing, "2026-05-30");
  const statusOf = (key: string) => r.threads.find((t) => t.key === key)?.status;

  it("carries an unresolved multi-night issue as still_open", () => {
    expect(statusOf("room:112")).toBe("still_open"); // aircon, open since the 26th
    expect(statusOf("room:309")).toBe("still_open"); // deposit, open since the 27th
  });

  it("marks issues that first appeared tonight as new_tonight", () => {
    expect(statusOf("room:226")).toBe("new_tonight"); // damage report
    expect(statusOf("room:214")).toBe("new_tonight"); // the injection note
  });

  it("marks issues resolved on the target shift as newly_resolved", () => {
    expect(statusOf("room:108")).toBe("newly_resolved");
  });

  it("does NOT re-report an item resolved on an earlier shift (the corridor leak)", () => {
    const leak = r.threads.find((t) => t.key === "room:215");
    expect(leak!.status).toBe("resolved_earlier");
    expect(leak!.resolvedShift).toBe("2026-05-29"); // resolved the night before
    expect(reportableThreads(r).some((t) => t.key === "room:215")).toBe(false);
  });

  it("suppresses an unrelated earlier-resolved item (lost keycard)", () => {
    expect(statusOf("room:118")).toBe("resolved_earlier");
    expect(reportableThreads(r).some((t) => t.key === "room:118")).toBe(false);
  });
});

describe("reconcile — target morning controls the classification", () => {
  it("classifies the same thread relative to whichever morning is asked for", () => {
    expect(reconcile(ing, "2026-05-26").threads.find((t) => t.key === "room:112")!.status).toBe(
      "new_tonight",
    );
    expect(reconcile(ing, "2026-05-30").threads.find((t) => t.key === "room:112")!.status).toBe(
      "still_open",
    );
  });

  it("does not yet know about threads from future shifts", () => {
    // room 309 first appears on the 27th; unknown at morning 26
    expect(reconcile(ing, "2026-05-26").threads.find((t) => t.key === "room:309")).toBeUndefined();
  });

  it("defaults the target morning to the most recent shift", () => {
    expect(reconcile(ing).targetMorning).toBe("2026-05-30");
  });
});
