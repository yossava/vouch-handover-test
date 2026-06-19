import { describe, it, expect } from "vitest";
import { assemble, type HandoverItem } from "../src/handover";
import { toResponseJson, toHtml, escapeHtml } from "../src/render";

function item(over: Partial<HandoverItem>): HandoverItem {
  return { key: "room:112", severity: "on_fire", status: "still_open", refs: ["evt_0002"], summary: "Aircon out of order", ...over };
}

describe("toResponseJson", () => {
  it("emits ordered action-first sections with tags + cited source_ids", () => {
    const h = assemble("2026-05-30", [item({ key: "room:112", refs: ["evt_0002", "evt_0018"] })], ["room:215"]);
    const json = toResponseJson(h, "lumen-sg");
    expect(json.hotel_id).toBe("lumen-sg");
    expect(json.as_of).toBe("2026-05-30");
    expect(Object.keys(json.sections)).toEqual(["EMERGENCY", "ON FIRE", "FLAGGED", "PENDING", "FYI"]);
    expect(json.sections["ON FIRE"][0]).toMatchObject({ room: "112", status: "still_open", source_ids: ["evt_0002", "evt_0018"] });
    expect(json.suppressed).toEqual([{ key: "room:215" }]);
  });

  it("reports all_clear from the handover (computed upstream from absence)", () => {
    expect(toResponseJson(assemble("2026-05-30", [], []), "x").all_clear).toBe(true);
  });
});

describe("toHtml", () => {
  const hotel = { id: "lumen-sg", name: "Lumen Boutique Hotel" };
  const at = "2026-05-30T07:00:00Z";

  it("renders a scannable header: hotel name, morning date, and a one-line tally", () => {
    const h = assemble("2026-05-30", [
      item({ key: "room:301", severity: "emergency", status: "new_tonight", summary: "Guest unwell" }),
      item({ key: "room:112", severity: "on_fire", status: "still_open", since: "2026-05-26" }),
    ], []);
    const html = toHtml(h, hotel, at);
    expect(html).toContain("Lumen Boutique Hotel");
    expect(html).toContain("Morning of 30 May 2026");
    expect(html).toContain("1 emergency · 1 on fire");
  });

  it("renders only non-empty sections, most-urgent first, with state badges + bold room", () => {
    const h = assemble("2026-05-30", [
      item({ key: "room:112", severity: "on_fire", status: "still_open", since: "2026-05-26" }),
      item({ key: "room:108", severity: "fyi", status: "newly_resolved", summary: "Check-in fine" }),
    ], []);
    const html = toHtml(h, hotel, at);
    expect(html).not.toContain("EMERGENCY"); // no emergency items -> section omitted entirely
    expect(html.indexOf("Room 112")).toBeLessThan(html.indexOf("Check-in fine")); // ON FIRE section before FYI
    expect(html).toContain("<strong>Room 112</strong>");
    expect(html).toContain("OPEN since 26 May");
    expect(html).toContain("RESOLVED overnight");
  });

  it("shows 'do not action' and both sides of a contradiction for flagged items", () => {
    const h = assemble("2026-05-30", [
      item({
        key: "room:312",
        severity: "flagged",
        status: "still_open",
        since: "2026-05-27",
        summary: "No-show charge disputed",
        flaggedReason: "contradiction across sources",
        contradiction: { a: "relief staff: charged & settled", b: "guest: cancelled at 21:00 within window" },
      }),
    ], []);
    const html = toHtml(h, hotel, at);
    expect(html).toContain("review — do not action");
    expect(html).toContain("charged &amp; settled"); // escaped, both sides shown
    expect(html).toContain("cancelled at 21:00");
  });

  it("escapes guest-controlled text (XSS)", () => {
    const h = assemble("2026-05-30", [item({ summary: "<script>alert(1)</script>", key: "room:<b>" })], []);
    const html = toHtml(h, hotel, at);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows an all-clear banner and the human-review footer", () => {
    const h = assemble("2026-05-30", [item({ severity: "fyi", status: "newly_resolved", summary: "noise resolved" })], []);
    const html = toHtml(h, hotel, at);
    expect(html).toContain("All clear");
    expect(html).toContain("human review before any charge");
  });
});

describe("escapeHtml", () => {
  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
