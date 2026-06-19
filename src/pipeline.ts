import { z } from "zod";
import { hotelSchema, eventSchema, type SampleData } from "./data.js";
import { ingest, type Event, type IngestResult } from "./ingest.js";
import { reconcile, type Thread } from "./reconcile.js";
import { assemble, threadToItem, type Handover, type HandoverItem } from "./handover.js";
import { severityForText } from "./severity.js";
import { enrichBlock } from "./llm/enrich.js";
import type { GroundingResult } from "./llm/grounding.js";
import type { Entry } from "./llm/schema.js";
import type { ChatComplete } from "./llm/client.js";

export const handoverRequestSchema = z.object({
  hotel: hotelSchema,
  events: z.array(eventSchema).optional(),
  nightLogs: z.string().optional(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD").optional(),
});
export type HandoverRequest = z.infer<typeof handoverRequestSchema>;

/** Minimal logger shape — pino / Fastify req.log satisfy it; tests pass a capturing fake. */
export interface PipelineLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
  child(bindings: object): PipelineLogger;
}

export interface PipelineDeps {
  complete?: ChatComplete; // when absent, free-text blocks surface deterministically (no translation)
  logger: PipelineLogger;
}

/**
 * Full pipeline: tolerant ingest -> reconcile -> model-enrich the free-text blocks ->
 * severity -> assemble. Code owns inclusion and severity; the model only enriches prose.
 * Structured logs (bound with hotel_id + as_of) make a bad handover debuggable: every
 * reconcile decision, every model call, every grounding rejection.
 */
export async function generateHandover(input: HandoverRequest, deps: PipelineDeps): Promise<Handover> {
  const data: SampleData = { hotel: input.hotel, events: input.events ?? [], nightLogs: input.nightLogs ?? "" };
  const ingested = ingest(data);
  const asOf = input.asOfDate ?? ingested.shifts.at(-1)?.morningDate ?? null;

  const log = deps.logger.child({ hotel_id: input.hotel.id, as_of: asOf });
  log.info(
    { events: ingested.events.length, blocks: ingested.logBlocks.length, shifts: ingested.shifts.length },
    "handover.ingested",
  );

  const recon = asOf ? reconcile(ingested, asOf) : null;
  const threads: Thread[] = recon?.threads ?? [];
  const pendingBlocks: Event[] = recon?.pendingBlocks ?? ingested.logBlocks;

  for (const t of threads) {
    log.info(
      { thread: t.key, status: t.status, first_shift: t.firstShift, resolved_shift: t.resolvedShift, refs: t.events.map((e) => e.id) },
      t.status === "resolved_earlier" ? "reconcile.suppressed" : "reconcile.thread",
    );
  }

  const reportable = threads.filter((t) => t.status !== "resolved_earlier");
  const suppressed = threads.filter((t) => t.status === "resolved_earlier").map((t) => t.key);
  const threadItems = reportable.map((t) => threadToItem(t, new Map<string, string>()));

  const sources = sourceMap(ingested);
  const blockItems: HandoverItem[] = [];
  for (const block of pendingBlocks) {
    if (!deps.complete) {
      blockItems.push(deterministicBlockItem(block));
      continue;
    }
    log.info({ block: block.id, chars: block.text.length }, "model.call");
    let result: GroundingResult | null = null;
    try {
      result = await enrichBlock(block, sources, deps.complete);
    } catch (err) {
      log.error({ block: block.id, error: (err as Error).message }, "model.error");
    }
    if (!result) {
      blockItems.push(deterministicBlockItem(block));
      continue;
    }
    for (const u of result.ungrounded) {
      for (const reason of u.reasons) {
        log.warn({ block: block.id, claim_summary: u.entry.summary, reason }, "grounding.reject");
      }
    }
    for (const entry of result.grounded) blockItems.push(entryToItem(entry, block));
  }

  const handover = assemble(asOf, [...threadItems, ...blockItems], suppressed);
  log.info(
    {
      all_clear: handover.allClear,
      counts: {
        emergency: handover.buckets.emergency.length,
        on_fire: handover.buckets.on_fire.length,
        flagged: handover.buckets.flagged.length,
        pending: handover.buckets.pending.length,
        fyi: handover.buckets.fyi.length,
      },
    },
    "handover.done",
  );
  return handover;
}

function sourceMap(ingested: IngestResult): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of ingested.events) m.set(e.id, e.text);
  for (const b of ingested.logBlocks) m.set(b.id, b.text);
  return m;
}

function entryToItem(entry: Entry, block: Event): HandoverItem {
  const room = entry.thread_hint?.room ?? null;
  const sev = severityForText(block.text, true); // severity off the ORIGINAL text (keeps non-English keywords)
  const item: HandoverItem = {
    key: room ? `room:${room}` : `block:${block.id}`,
    severity: sev.severity,
    status: "new_tonight",
    refs: [...new Set(entry.claims.flatMap((c) => c.source_ids))],
    summary: entry.summary,
  };
  if (sev.reason) item.flaggedReason = sev.reason;
  return item;
}

function deterministicBlockItem(block: Event): HandoverItem {
  const sev = severityForText(block.text, true);
  const item: HandoverItem = {
    key: `block:${block.id}`,
    severity: sev.severity,
    status: "new_tonight",
    refs: [block.id],
    summary: block.text,
  };
  if (sev.reason) item.flaggedReason = sev.reason;
  return item;
}
