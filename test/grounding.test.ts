import { describe, it, expect } from "vitest";
import { validateEntries, summaryViolations } from "../src/llm/grounding";
import type { Entry } from "../src/llm/schema";

const sources = new Map<string, string>([
  [
    "evt_0007",
    "Card declined for SGD 100 deposit. Guest says will settle in the morning. No deposit collected.",
  ],
  [
    "log_0007",
    "Room 112 aircon — maintenance came, it's the compressor, part needs ordering. 112 stays out of order.",
  ],
]);

function entry(over: Partial<Entry>): Entry {
  return {
    kind: "finance",
    summary: "Deposit of SGD 100 was not collected.",
    claims: [
      { text: "No deposit collected", source_ids: ["evt_0007"], evidence_quote: "No deposit collected" },
    ],
    ...over,
  };
}

describe("grounding layer 1 — evidence_quote must be verbatim", () => {
  it("keeps an entry whose quote is a verbatim substring of its cited source", () => {
    const r = validateEntries([entry({})], sources);
    expect(r.grounded).toHaveLength(1);
    expect(r.ungrounded).toHaveLength(0);
  });

  it("drops an entry whose evidence_quote is fabricated", () => {
    const bad = entry({
      claims: [
        {
          text: "Deposit was waived",
          source_ids: ["evt_0007"],
          evidence_quote: "deposit was waived by the manager", // never appears in the source
        },
      ],
    });
    const r = validateEntries([bad], sources);
    expect(r.grounded).toHaveLength(0);
    expect(r.ungrounded).toHaveLength(1);
    expect(r.ungrounded[0].reasons.join(" ")).toMatch(/evidence_quote not found/);
  });

  it("drops a claim that cites a non-existent source id", () => {
    const bad = entry({
      claims: [{ text: "x", source_ids: ["evt_9999"], evidence_quote: "No deposit collected" }],
    });
    const r = validateEntries([bad], sources);
    expect(r.ungrounded).toHaveLength(1);
    expect(r.ungrounded[0].reasons.join(" ")).toMatch(/unknown source/);
  });

  it("holds a translation's original_quote to the same verbatim bar", () => {
    const bad = entry({
      translation: { english: "made up", original_quote: "这句话不在原文里" },
    });
    const r = validateEntries([bad], sources);
    expect(r.ungrounded[0].reasons.join(" ")).toMatch(/translation original_quote/);
  });
});

describe("grounding layer 2 — summary may not introduce unsourced entities", () => {
  it("catches a summary that invents a money amount", () => {
    const bad = entry({ summary: "Night staff want to charge a SGD 500 damage fee." });
    const r = validateEntries([bad], sources);
    expect(r.grounded).toHaveLength(0);
    expect(r.ungrounded[0].reasons.join(" ")).toMatch(/number not in sources: 500/);
  });

  it("catches a summary that invents a room number", () => {
    const bad = entry({ summary: "Aircon fault reported in room 999." });
    const r = validateEntries([bad], sources);
    expect(r.ungrounded[0].reasons.join(" ")).toMatch(/number not in sources: 999/);
  });

  it("catches a summary that invents a guest name", () => {
    const bad = entry({ summary: "Deposit dispute raised by Charlie Brown." });
    const r = validateEntries([bad], sources);
    expect(r.ungrounded[0].reasons.join(" ")).toMatch(/name not in sources: Charlie Brown/);
  });

  it("allows a summary whose numbers all trace to the cited source", () => {
    const ok = entry({ summary: "SGD 100 deposit was not collected." }); // 100 is in evt_0007
    expect(validateEntries([ok], sources).grounded).toHaveLength(1);
  });

  it("summaryViolations reports each missing entity in order", () => {
    expect(summaryViolations("charge SGD 500 to room 999", "only SGD 100 here")).toEqual([
      "summary introduces number not in sources: 500",
      "summary introduces number not in sources: 999",
    ]);
  });
});
