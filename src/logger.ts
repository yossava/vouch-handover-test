import pino from "pino";

// One structured logger for the whole service: HTTP (via Fastify) and the
// handover pipeline both log through this, so every line is JSON and carries
// `service`. Pipeline logs will add hotel / night / reason for debuggability.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "vouch-handover" },
});
