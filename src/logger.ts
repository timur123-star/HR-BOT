import { config } from "./config.js";
import { redactPii } from "./format.js";

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Поля, которые могут содержать PII кандидата. Перед сериализацией
 * прогоняются через `redactPii`, чтобы в логах не светились
 * полные имена / handle / телефоны.
 */
const PII_KEYS = new Set([
  "candidate",
  "candidate_name",
  "candidate_tg",
  "name",
  "phone",
  "handle",
  "email",
]);

function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === "string" && PII_KEYS.has(k)) {
      out[k] = redactPii(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function log(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (order[level] < order[config.runtime.logLevel as Level]) return;
  const ts = new Date().toISOString();
  const safeMeta = meta ? redactMeta(meta) : undefined;
  const payload = safeMeta ? ` ${JSON.stringify(safeMeta)}` : "";
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}${payload}`);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
};
