import { describe, it, expect } from "vitest";
import { callStructured, type ChatMessage } from "../src/llm/client";
import { blockEnrichmentSchema } from "../src/llm/schema";

function fakeComplete(responses: string[]) {
  let i = 0;
  return {
    fn: async (_messages: ChatMessage[]): Promise<string> => responses[Math.min(i++, responses.length - 1)]!,
    count: () => i,
  };
}

const validEnrichment = JSON.stringify({
  entries: [
    { kind: "finance", summary: "x", claims: [{ text: "x", source_ids: ["log_0001"], evidence_quote: "x" }] },
  ],
});

describe("callStructured — Zod validation + re-ask", () => {
  it("re-asks when the model free-texts an enum, then accepts the corrected json", async () => {
    const badEnum = JSON.stringify({
      entries: [
        { kind: "money_stuff", summary: "x", claims: [{ text: "x", source_ids: ["log_0001"], evidence_quote: "x" }] },
      ],
    });
    const fake = fakeComplete([badEnum, validEnrichment]);
    const out = await callStructured(fake.fn, [{ role: "user", content: "json" }], blockEnrichmentSchema, 2);
    expect(out.entries[0].kind).toBe("finance");
    expect(fake.count()).toBe(2); // one bad attempt + one corrected
  });

  it("throws when the model never returns conforming json", async () => {
    const fake = fakeComplete(["not json", "still not json", "nope"]);
    await expect(
      callStructured(fake.fn, [{ role: "user", content: "json" }], blockEnrichmentSchema, 2),
    ).rejects.toThrow(/failed schema validation/);
  });
});
