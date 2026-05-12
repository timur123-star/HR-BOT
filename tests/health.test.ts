import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { startHealthServer, stopHealthServer } from "../src/health.js";

function fetchUrl(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
  });
}

describe("health server", () => {
  afterEach(async () => {
    await stopHealthServer();
  });

  it("returns 200 OK on /health with JSON status", async () => {
    const port = 28091;
    await startHealthServer(port);
    const res = await fetchUrl(`http://127.0.0.1:${port}/health`);
    expect(res.statusCode).toBe(200);
    const parsed: unknown = JSON.parse(res.body);
    expect(parsed).toMatchObject({ status: "ok" });
    expect((parsed as { uptime: number }).uptime).toBeGreaterThanOrEqual(0);
  });

  it("returns 200 on /healthz alias", async () => {
    const port = 28092;
    await startHealthServer(port);
    const res = await fetchUrl(`http://127.0.0.1:${port}/healthz`);
    expect(res.statusCode).toBe(200);
  });

  it("returns 404 on other paths", async () => {
    const port = 28093;
    await startHealthServer(port);
    const res = await fetchUrl(`http://127.0.0.1:${port}/anything-else`);
    expect(res.statusCode).toBe(404);
  });

  it("is idempotent: calling start twice does not error", async () => {
    const port = 28094;
    await startHealthServer(port);
    await startHealthServer(port);
    const res = await fetchUrl(`http://127.0.0.1:${port}/health`);
    expect(res.statusCode).toBe(200);
  });
});
