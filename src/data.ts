import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";

// Resolve <repo>/data from this module's location, so it works the same in dev
// (src/), in the built output (dist/), and under the test runner.
const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, "..", "data");

export const hotelSchema = z.object({
  id: z.string(),
  name: z.string(),
  rooms: z.number(),
  timezone: z.string(),
});

// Validate the file's shape only. Kind / severity / grounding are decided later
// by the model + code (see CLAUDE.md), not baked into the ingest schema.
export const eventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  room: z.string().nullable(),
  guest: z.string().nullable(),
  description: z.string(),
  status: z.string(),
});

const eventsFileSchema = z.object({
  hotel: hotelSchema,
  note: z.string().optional(),
  events: z.array(eventSchema),
});

export type Hotel = z.infer<typeof hotelSchema>;
export type FrontDeskEvent = z.infer<typeof eventSchema>;

export interface SampleData {
  hotel: Hotel;
  events: FrontDeskEvent[];
  nightLogs: string;
}

/** Load and validate the two committed sample files in data/. */
export function loadSampleData(): SampleData {
  const eventsRaw = readFileSync(join(DATA_DIR, "events.json"), "utf8");
  const { hotel, events } = eventsFileSchema.parse(JSON.parse(eventsRaw));
  const nightLogs = readFileSync(join(DATA_DIR, "night-logs.md"), "utf8");
  return { hotel, events, nightLogs };
}
