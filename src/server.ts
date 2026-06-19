import Fastify, { type FastifyError } from "fastify";
import { logger } from "./logger.js";
import { loadSampleData } from "./data.js";
import { generateHandover, handoverRequestSchema } from "./pipeline.js";
import { toResponseJson, toHtml } from "./render.js";
import { deepSeekComplete, type ChatComplete } from "./llm/client.js";
import type { Handover } from "./handover.js";

export function buildServer(opts: { complete?: ChatComplete } = {}) {
  const app = Fastify({ loggerInstance: logger });
  // `complete: undefined` (explicit) forces the deterministic path; omit it to use DeepSeek.
  const complete = "complete" in opts ? opts.complete : tryDeepSeek(app.log);
  const sampleCache = new Map<string, Handover>(); // bundled sample is static — cache to keep the GET demo cheap

  // Never leak internals to the client; log the detail, return a generic body.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const code = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    // 4xx are client errors with safe messages; 5xx stay generic so internals never leak.
    if (code < 500) req.log.warn({ error: err.message, code }, "request.rejected");
    else req.log.error({ error: err.message }, "request.error");
    reply.code(code).send({ error: code < 500 ? err.message : "internal error" });
  });

  app.get("/health", async () => {
    const data = loadSampleData();
    return {
      status: "ok",
      service: "vouch-handover",
      data: { hotel: data.hotel.id, events: data.events.length, nightLogChars: data.nightLogs.length },
    };
  });

  app.post("/handover", async (req, reply) => {
    const parsed = handoverRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "invalid request body", details: issues(parsed.error) };
    }
    const handover = await generateHandover(parsed.data, { complete, logger: req.log });
    return toResponseJson(handover, parsed.data.hotel.id);
  });

  app.get("/handover", async (req, reply) => {
    const q = req.query as { date?: string; format?: string };
    const sample = loadSampleData();
    const parsed = handoverRequestSchema.safeParse({
      hotel: sample.hotel,
      events: sample.events,
      nightLogs: sample.nightLogs,
      asOfDate: q.date,
    });
    if (!parsed.success) {
      reply.code(400);
      return { error: "invalid query", details: issues(parsed.error) };
    }

    const cacheKey = q.date ?? "latest";
    let handover = sampleCache.get(cacheKey);
    if (!handover) {
      handover = await generateHandover(parsed.data, { complete, logger: req.log });
      sampleCache.set(cacheKey, handover);
    }

    if (q.format === "html") {
      reply.type("text/html");
      return toHtml(handover, sample.hotel, new Date().toISOString());
    }
    return toResponseJson(handover, sample.hotel.id);
  });

  return app;
}

function issues(error: { issues: { path: (string | number | symbol)[]; message: string }[] }) {
  return error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
}

function tryDeepSeek(log: { warn(o: object, m: string): void }): ChatComplete | undefined {
  try {
    return deepSeekComplete();
  } catch (err) {
    log.warn({ error: (err as Error).message }, "deepseek.unavailable — running deterministic, no model enrichment");
    return undefined;
  }
}
