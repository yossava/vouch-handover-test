import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Keep the structured logger quiet during unit tests.
    env: { LOG_LEVEL: "silent" },
  },
});
