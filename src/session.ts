import { createClient, type RedisClientType } from "redis";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { InterviewSession } from "./types.js";

let client: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (client) return client;
  const c: RedisClientType = createClient({ url: config.redis.url });
  c.on("error", (err: Error) => logger.error("Redis error", { error: err.message }));
  await c.connect();
  client = c;
  return c;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

const key = (tgId: number): string => `interview:${tgId}`;

export async function loadSession(tgId: number): Promise<InterviewSession | null> {
  const r = await getRedis();
  const raw = await r.get(key(tgId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as InterviewSession;
  } catch (err) {
    logger.warn("Failed to parse session", { tgId, error: String(err) });
    return null;
  }
}

export async function saveSession(tgId: number, session: InterviewSession): Promise<void> {
  const r = await getRedis();
  await r.set(key(tgId), JSON.stringify(session), { EX: config.runtime.sessionTtl });
}

export async function dropSession(tgId: number): Promise<void> {
  const r = await getRedis();
  await r.del(key(tgId));
}
