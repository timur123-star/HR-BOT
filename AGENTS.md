# AGENTS.md

## Cursor Cloud specific instructions

### Overview

HR-BOT is a Telegram bot for automated candidate screening. Stack: Node.js 20+, TypeScript (strict), Telegraf 4, PostgreSQL 16, Redis 7, Groq LLM, Google Sheets API, PDFKit.

### Infrastructure

PostgreSQL and Redis are started via `docker compose up -d postgres redis` (do NOT start the `bot` service from compose — run the bot natively with `npm run dev`). Docker must be running first: `sudo -n dockerd &>/dev/null &` then `sudo -n chmod 666 /var/run/docker.sock`.

### Running the bot

The bot requires `TELEGRAM_BOT_TOKEN` (real token from BotFather). Without it, the process starts, connects to Postgres/Redis, runs migrations, seeds demo vacancies, starts the health server on `:8081`, but crashes at the Telegram API call. Optional services (Google Sheets, Groq, SMTP) degrade gracefully when their env vars are absent.

To run in dev mode: `npm run dev` (uses `tsx watch` with hot-reload).

### Quality checks

All commands are in `package.json` scripts. The CI pipeline is: `format:check` → `lint` → `typecheck` → `build` → `test`. See README for details.

- `npm run lint` — ESLint
- `npm run format:check` — Prettier check
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest (36 unit tests, no live services needed)
- `npm run build` — TypeScript compilation to `dist/`

### Gotchas

- Unit tests (`npm test`) do NOT require Postgres, Redis, or any external API — `tests/setup.ts` sets dummy env vars and tests mock all external deps.
- The `.env` file needs `TELEGRAM_BOT_TOKEN` set to a valid token (min 10 chars) for the bot to pass Zod schema validation at startup.
- Husky pre-commit hook runs `npx lint-staged` (Prettier + ESLint on staged `.ts` files).
- The project uses ESM (`"type": "module"` in package.json) — imports use `.js` extensions in source.
