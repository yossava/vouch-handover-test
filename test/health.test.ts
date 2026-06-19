import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server";

describe("GET /health", () => {
  it("returns ok and a summary of the loaded sample data", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.data.hotel).toBe("lumen-sg");
    expect(body.data.events).toBeGreaterThan(0);
    expect(body.data.nightLogChars).toBeGreaterThan(0);

    await app.close();
  });
});
