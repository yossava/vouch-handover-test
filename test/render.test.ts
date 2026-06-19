import { describe, it, expect } from "vitest";
import { assemble, type HandoverItem } from "../src/handover";
import { toResponseJson, toHtml, escapeHtml } from "../src/render";

function item(over: Partial<HandoverItem>): HandoverItem {
  return { key: "room:112", severity: "on_fire", status: "still_open", refs: ["evt_0002"], summary: "Aircon out of order", ...over };
}

describe("toResponseJson", () => {
  it("emits ordered action-first sections with tags + cited source_ids", () => {
    const h = assemble(
      "2026-05-30",
      [item({ key: "room:112", refs: ["evt_0002", "evt_0018"] })],
      ["room:215"],
    );
    const json = toResponseJson(h, "lumen-sg");
    expect(json.hotel_id).toBe("lumen-sg");
    expect(json.as_of).toBe("2026-05-30");
    expect(Object.keys(json.sections)).toEqual(["EMERGENCY", "ON FIRE", "FLAGGED", "PENDING", "FYI"]);
    expect(json.sections["ON FIRE"][0]).toMatchObject({
      room: "112",
      status: "still_open",
      source_ids: ["evt_0002", "evt_0018"],
    });
    expect(json.suppressed).toEqual([{ key: "room:215" }]);
  });

  it("reports all_clear from the handover (computed upstream from absence)", () => {
    const empty = assemble("2026-05-30", [], []);
    expect(toResponseJson(empty, "x").all_clear).toBe(true);
  });
});

describe("toHtml", () => {
  it("escapes guest-controlled text (XSS)", () => {
    const h = assemble("2026-05-30", [item({ summary: '<script>alert(1)</script>', key: "room:<b>" })], []);
    const html = toHtml(h, "lumen-sg");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("Room <b>:");
  });
});

describe("escapeHtml", () => {
  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
