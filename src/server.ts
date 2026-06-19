import Fastify from "fastify";
import { logger } from "./logger.js";
import { loadSampleData } from "./data.js";

export function buildServer() {
  const app = Fastify({ loggerInstance: logger });
  const data = loadSampleData();

  app.get("/health", async () => ({
    status: "ok",
    service: "vouch-handover",
    data: {
      hotel: data.hotel.id,
      events: data.events.length,
      nightLogChars: data.nightLogs.length,
    },
  }));

  return app;
}
