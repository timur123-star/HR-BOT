import { afterEach, describe, expect, it, vi } from "vitest";

// Mock'ируем Redis client до импорта session.
const incrMock = vi.fn();
const expireMock = vi.fn();
const fakeClient = { incr: incrMock, expire: expireMock };

vi.mock("../src/session.js", () => ({
  getRedis: async () => fakeClient,
}));

import { checkRate } from "../src/ratelimit.js";

afterEach(() => {
  incrMock.mockReset();
  expireMock.mockReset();
});

describe("checkRate", () => {
  it("allows first call and sets TTL", async () => {
    incrMock.mockResolvedValueOnce(1);
    expireMock.mockResolvedValueOnce(true);
    const ok = await checkRate(123, "start", 5, 60);
    expect(ok).toBe(true);
    expect(expireMock).toHaveBeenCalledWith("rate:start:123", 60);
  });

  it("allows calls up to max", async () => {
    incrMock.mockResolvedValueOnce(5);
    const ok = await checkRate(123, "start", 5, 60);
    expect(ok).toBe(true);
    expect(expireMock).not.toHaveBeenCalled();
  });

  it("rejects calls over max", async () => {
    incrMock.mockResolvedValueOnce(6);
    const ok = await checkRate(123, "start", 5, 60);
    expect(ok).toBe(false);
  });

  it("fails open if Redis errors", async () => {
    incrMock.mockRejectedValueOnce(new Error("connection refused"));
    const ok = await checkRate(123, "start", 5, 60);
    expect(ok).toBe(true);
  });
});
