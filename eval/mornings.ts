/*
 * Generate handovers for the mornings of 28/29/30 May against the REAL model and
 * verify the documented behaviours.
 * Usage:  node --env-file=.env --import tsx eval/mornings.ts
 */
import { loadSampleData } from "../src/data.js";
import { ingest } from "../src/ingest.js";
import { generateHandover, type PipelineLogger } from "../src/pipeline.js";
import { enrichBlock } from "../src/llm/enrich.js";
import { deepSeekComplete } from "../src/llm/client.js";
import { severityForText } from "../src/severity.js";

const data = loadSampleData();
const complete = deepSeekComplete();
const silent: PipelineLogger = { info() {}, warn() {}, error() {}, child: () => silent };
const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n) + "…" : s);

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean) => {
  results.push({ name, ok });
  console.log(`   ${ok ? "✓" : "✗"} ${name}`);
};

for (const date of ["2026-05-28", "2026-05-29", "2026-05-30"]) {
  const h = await generateHandover(
    { hotel: data.hotel, events: data.events, nightLogs: data.nightLogs, asOfDate: date },
    { complete, logger: silent },
  );
  console.log(`\n===== Morning of ${date}  (all_clear=${h.allClear}) =====`);
  for (const sev of ["emergency", "on_fire", "flagged", "pending", "fyi"] as const) {
    const items = h.buckets[sev];
    if (!items.length) continue;
    console.log(` ${sev.toUpperCase()} (${items.length}):`);
    for (const i of items) {
      const room = i.key.startsWith("room:") ? `Room ${i.key.slice(5)}` : i.key;
      console.log(`   • ${room} [${i.status}] ${short(i.summary)}  <${i.refs.join(",")}>`);
      if (i.flaggedReason) console.log(`       ⚠ ${i.flaggedReason}`);
    }
  }
  if (h.suppressed.length) console.log(` suppressed (resolved earlier, not re-reported): ${h.suppressed.join(", ")}`);

  const find = (k: string) => h.items.find((i) => i.key === k);
  if (date === "2026-05-29") check("29th: 2F leak (215) newly_resolved", find("room:215")?.status === "newly_resolved");
  if (date === "2026-05-30") {
    check("30th: evt_0026 injection FLAGGED + not all-clear", find("room:214")?.severity === "flagged" && !h.allClear);
    check("30th: 112 aircon still_open (across formats)", find("room:112")?.status === "still_open");
    check("30th: 309 deposit on_fire before checkout", find("room:309")?.severity === "on_fire");
    check("30th: 48h immigration backlog (204) on_fire", find("room:204")?.severity === "on_fire");
    check("30th: 312 no-show FLAGGED contradictory", find("room:312")?.severity === "flagged" && /contradiction/.test(find("room:312")?.flaggedReason ?? ""));
    check("30th: 226 damage FLAGGED incomplete", find("room:226")?.severity === "flagged" && /incomplete/.test(find("room:226")?.flaggedReason ?? ""));
    check("30th: items resolved earlier (215) don't resurface", !find("room:215") && h.suppressed.includes("room:215"));
  }
}

console.log("\n===== 208 safe (Chinese, free-text only) — model translation + grounding =====");
const blocks = ingest(data).logBlocks;
const safeBlock = blocks.find((b) => b.text.includes("保险箱"))!;
const sources = new Map(blocks.map((b) => [b.id, b.text]));
const enriched = await enrichBlock(safeBlock, sources, complete);
const entry = enriched.grounded[0];
console.log(" original :", safeBlock.text);
console.log(" english  :", entry?.summary ?? "(none)");
console.log(" quote    :", entry?.claims?.[0]?.evidence_quote);
check("208 entry is on_fire", severityForText(safeBlock.text, true).severity === "on_fire");
check(
  "208 entry grounded (every evidence_quote is a verbatim substring of the Chinese source)",
  !!entry && entry.claims.length > 0 && entry.claims.every((c) => safeBlock.text.includes(c.evidence_quote)),
);

const passed = results.filter((r) => r.ok).length;
console.log(`\n===== ${passed}/${results.length} checks passed =====`);
if (passed !== results.length) process.exit(1);
