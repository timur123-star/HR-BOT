import http from "node:http";
import { config } from "./config.js";
import { logger } from "./logger.js";

let server: http.Server | null = null;

/**
 * Поднимает простой HTTP-сервер с эндпоинтом /health.
 *
 * Используется для:
 * - Docker HEALTHCHECK (`wget --spider http://localhost:PORT/health`)
 * - Kubernetes liveness/readiness probe
 * - Railway/Render healthcheck
 *
 * Возвращает 200 OK с JSON статусом если бот запущен. По умолчанию слушает
 * на HEALTH_PORT (8081), не пересекаясь с WEBHOOK_PORT.
 */
export async function startHealthServer(port: number): Promise<void> {
  if (server) return;
  await new Promise<void>((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url === "/health" || req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            uptime: Math.floor(process.uptime()),
            groq: config.groq.enabled,
            sheets: config.sheets.enabled,
          })
        );
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });
    server.listen(port, () => {
      logger.info("Health server listening", { port });
      resolve();
    });
  });
}

export async function stopHealthServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((err) => (err ? reject(err) : resolve()));
  });
  server = null;
}
