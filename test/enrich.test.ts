import { describe, it, expect } from "vitest";
import { enrichBlock } from "../src/llm/enrich";
import type { Event } from "../src/ingest";

// A night-log block; the model is faked so this stays offline.
const block: Event = {
  id: "log_0013",
  ts: null,
  room: null,
  guest: null,
  type: null,
  text: "208 房的客人说房间的保险箱打不开了，护照锁在里面。",
  source: "night-log",
  status: null,
};
const sources = new Map([[block.id, block.text]]);

function fake(json: string) {
  return async () => json;
}

describe("enrichBlock — model output flows through Zod + grounding", () => {
  it("ships a grounded, translated entry", async () => {
    const modelOut = JSON.stringify({
      entries: [
        {
          kind: "maintenance",
          summary: "Guest in 208 reports the room safe will not open; passport locked inside.",
          language: "zh",
          translation: { english: "The room safe won't open; passport is locked inside.", original_quote: "保险箱打不开了" },
          thread_hint: { room: "208" },
          claims: [
            { text: "Safe will not open", source_ids: ["log_0013"], evidence_quote: "保险箱打不开了" },
          ],
        },
      ],
    });
    const r = await enrichBlock(block, sources, fake(modelOut));
    expect(r.grounded).toHaveLength(1);
    expect(r.grounded[0].translation?.original_quote).toBe("保险箱打不开了");
    expect(r.ungrounded).toHaveLength(0);
  });

  it("routes a fabricated quote to the ungrounded bucket, not the handover", async () => {
    const modelOut = JSON.stringify({
      entries: [
        {
          kind: "maintenance",
          summary: "Safe issue in room 208.",
          claims: [
            { text: "Safe broken", source_ids: ["log_0013"], evidence_quote: "the safe is completely destroyed" },
          ],
        },
      ],
    });
    const r = await enrichBlock(block, sources, fake(modelOut));
    expect(r.grounded).toHaveLength(0);
    expect(r.ungrounded).toHaveLength(1);
  });
});
