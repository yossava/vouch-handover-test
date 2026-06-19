import Fastify, { type FastifyError } from "fastify";
import { logger } from "./logger.js";
import { loadSampleData } from "./data.js";
import { generateHandover, handoverRequestSchema } from "./pipeline.js";
import { toResponseJson, toHtml, formPage, errorPage } from "./render.js";
import { deepSeekComplete, type ChatComplete } from "./llm/client.js";
import type { Handover } from "./handover.js";

const FORM_EXAMPLE = JSON.stringify(
  {
    hotel: { id: "demo-1", name: "Demo Inn", rooms: 20, timezone: "+08:00" },
    events: [
      { id: "e1", timestamp: "2026-07-01T23:50:00+08:00", type: "maintenance", room: "204", guest: null, description: "Aircon leaking onto the carpet. Bucket placed. Needs repair.", status: "unresolved" },
      { id: "e2", timestamp: "2026-07-02T02:10:00+08:00", type: "damage", room: "118", guest: "A. Tan", description: "Cracked mirror found after checkout. Night staff proposes a SGD 200 charge. No photos, no manager approval.", status: "pending" },
    ],
    nightLogs: "210 房客人反映热水器不工作，明早要洗澡。Walk-in turned away, fully booked.",
    asOfDate: "2026-07-02",
  },
  null,
  2,
);

export function buildServer(opts: { complete?: ChatComplete } = {}) {
  const app = Fastify({ loggerInstance: logger });
  // `complete: undefined` (explicit) forces the deterministic path; omit it to use DeepSeek.
  const complete = "complete" in opts ? opts.complete : tryDeepSeek(app.log);
  const sampleCache = new Map<string, Handover>(); // bundled sample is static — cache to keep the GET demo cheap

  // Accept HTML form posts (application/x-www-form-urlencoded) without a new dependency.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  // Never leak internals to the client; log the detail, return a generic/safe body.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const code = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
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

  // Browser form: paste a submission, view the rendered handover.
  app.get("/", async (_req, reply) => {
    reply.type("text/html");
    return formPage(FORM_EXAMPLE);
  });

  app.post("/form", async (req, reply) => {
    reply.type("text/html");
    const payload = (req.body as { payload?: string } | undefined)?.payload ?? "";
    let body: unknown;
    try {
      body = JSON.parse(payload);
    } catch {
      reply.code(400);
      return errorPage("That isn't valid JSON. Check the body and try again.");
    }
    const parsed = handoverRequestSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400);
      return errorPage("Validation failed:\n" + issues(parsed.error).map((i) => `${i.path}: ${i.message}`).join("\n"));
    }
    try {
      const handover = await generateHandover(parsed.data, { complete, logger: req.log });
      return toHtml(handover, parsed.data.hotel, new Date().toISOString());
    } catch (err) {
      const e = err as FastifyError;
      const client = e.statusCode !== undefined && e.statusCode < 500;
      reply.code(client ? e.statusCode! : 500);
      return errorPage(client ? e.message : "Internal error generating the handover.");
    }
  });

  app.post("/handover", async (req, reply) => {
    const parsed = handoverRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "invalid request body", details: issues(parsed.error) };
    }
    const handover = await generateHandover(parsed.data, { complete, logger: req.log });
    if ((req.query as { format?: string }).format === "html") {
      reply.type("text/html");
      return toHtml(handover, parsed.data.hotel, new Date().toISOString());
    }
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
