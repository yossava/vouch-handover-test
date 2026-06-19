import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server";

// Force the deterministic path (no network) by passing complete: undefined explicitly.
function server() {
  return buildServer({ complete: undefined });
}

const hotel = { id: "lumen-sg", name: "Lumen", rooms: 40, timezone: "+08:00" };

describe("GET /health", () => {
  it("reports the loaded sample", async () => {
    const app = server();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    await app.close();
  });
});

describe("GET /handover (bundled sample)", () => {
  it("returns action-first JSON sections with tags + source_ids; injection note is FLAGGED", async () => {
    const app = server();
    const res = await app.inject({ method: "GET", url: "/handover?date=2026-05-30&format=json" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hotel_id).toBe("lumen-sg");
    expect(body.as_of).toBe("2026-05-30");
    expect(Object.keys(body.sections)).toEqual(["EMERGENCY", "ON FIRE", "FLAGGED", "PENDING", "FYI"]);
    expect(body.sections["FLAGGED"].some((i: { room: string | null }) => i.room === "214")).toBe(true);

    const all = Object.values(body.sections).flat() as { status: string; source_ids: unknown }[];
    expect(
      all.every((i) => Array.isArray(i.source_ids) && ["still_open", "newly_resolved", "new_tonight"].includes(i.status)),
    ).toBe(true);
    await app.close();
  });

  it("renders HTML on format=html", async () => {
    const app = server();
    const res = await app.inject({ method: "GET", url: "/handover?format=html" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.body).toContain("<h1>Night-shift handover");
    await app.close();
  });
});

describe("POST /handover (tolerant input)", () => {
  it("accepts events only", async () => {
    const app = server();
    const res = await app.inject({
      method: "POST",
      url: "/handover",
      payload: {
        hotel,
        events: [
          { id: "evt_1", timestamp: "2026-05-30T02:00:00+08:00", type: "maintenance", room: "101", guest: null, description: "Aircon out of order", status: "unresolved" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.as_of).toBe("2026-05-30");
    expect(body.sections["ON FIRE"].some((i: { room: string | null }) => i.room === "101")).toBe(true);
    await app.close();
  });

  it("accepts nightLogs only", async () => {
    const app = server();
    const res = await app.inject({
      method: "POST",
      url: "/handover",
      payload: { hotel, nightLogs: "Guest in 208 reports the safe will not open; passport locked inside." },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects an invalid body with 400 (no stack/leak)", async () => {
    const app = server();
    const res = await app.inject({ method: "POST", url: "/handover", payload: { events: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/invalid request/);
    await app.close();
  });
});
