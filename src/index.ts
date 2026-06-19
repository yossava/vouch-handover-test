import { buildServer } from "./server.js";

// Load .env from the working directory if present (under PM2/CI the env is usually injected directly).
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the ambient environment.
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildServer();

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
