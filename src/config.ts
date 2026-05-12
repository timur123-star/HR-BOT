import "dotenv/config";
import { z } from "zod";
import fs from "node:fs";

const intFromEnv = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : Number(v)));

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10, "TELEGRAM_BOT_TOKEN is required"),
  ADMIN_USER_ID: intFromEnv,

  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),

  DATABASE_URL: z.string().default("postgres://hrbot:hrbot@localhost:5432/hrbot"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  GOOGLE_CREDENTIALS_JSON: z.string().optional(),
  GOOGLE_CREDENTIALS_FILE: z.string().optional(),
  GOOGLE_SHEET_ID: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: intFromEnv,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("HR Bot <noreply@example.com>"),
  RECRUITER_EMAIL: z.string().optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SESSION_TTL_SECONDS: intFromEnv,
  MIN_ANSWER_LENGTH: intFromEnv,
  HEALTH_PORT: intFromEnv,

  // Опциональный webhook-режим. Если WEBHOOK_URL задан — бот работает через
  // webhook (лучше для scale), иначе — long-polling.
  WEBHOOK_URL: z.string().optional(),
  WEBHOOK_PORT: intFromEnv,
  WEBHOOK_SECRET: z.string().optional(),
});

const parsed = EnvSchema.parse(process.env);

function readGoogleCredentials(): Record<string, unknown> | null {
  if (parsed.GOOGLE_CREDENTIALS_JSON) {
    try {
      return JSON.parse(parsed.GOOGLE_CREDENTIALS_JSON) as Record<string, unknown>;
    } catch {
      throw new Error("GOOGLE_CREDENTIALS_JSON is not valid JSON");
    }
  }
  if (parsed.GOOGLE_CREDENTIALS_FILE && fs.existsSync(parsed.GOOGLE_CREDENTIALS_FILE)) {
    return JSON.parse(fs.readFileSync(parsed.GOOGLE_CREDENTIALS_FILE, "utf8")) as Record<
      string,
      unknown
    >;
  }
  return null;
}

export const config = {
  telegram: {
    botToken: parsed.TELEGRAM_BOT_TOKEN,
    adminUserId: parsed.ADMIN_USER_ID,
  },
  groq: {
    apiKey: parsed.GROQ_API_KEY ?? "",
    model: parsed.GROQ_MODEL,
    enabled: Boolean(parsed.GROQ_API_KEY),
  },
  db: {
    url: parsed.DATABASE_URL,
  },
  redis: {
    url: parsed.REDIS_URL,
  },
  sheets: {
    sheetId: parsed.GOOGLE_SHEET_ID ?? "",
    credentials: readGoogleCredentials(),
    enabled: Boolean(parsed.GOOGLE_SHEET_ID) && Boolean(readGoogleCredentials()),
  },
  email: {
    host: parsed.SMTP_HOST ?? "",
    port: parsed.SMTP_PORT ?? 587,
    user: parsed.SMTP_USER ?? "",
    pass: parsed.SMTP_PASS ?? "",
    from: parsed.SMTP_FROM,
    recruiter: parsed.RECRUITER_EMAIL ?? "",
    enabled: Boolean(parsed.SMTP_HOST) && Boolean(parsed.RECRUITER_EMAIL),
  },
  runtime: {
    logLevel: parsed.LOG_LEVEL,
    sessionTtl: parsed.SESSION_TTL_SECONDS ?? 3600,
    minAnswerLength: parsed.MIN_ANSWER_LENGTH ?? 20,
    healthPort: parsed.HEALTH_PORT ?? 8081,
  },
  webhook: {
    url: parsed.WEBHOOK_URL ?? "",
    port: parsed.WEBHOOK_PORT ?? 8080,
    secret: parsed.WEBHOOK_SECRET ?? "",
    enabled: Boolean(parsed.WEBHOOK_URL),
  },
} as const;

export type Config = typeof config;
