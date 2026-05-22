# AGENTS.md

## Cursor Cloud specific instructions

### Overview

HR-BOT is a Telegram bot for automated candidate screening. The stack is Node.js 20 + TypeScript (strict), Telegraf 4, PostgreSQL 16, Redis 7, Groq LLM, Google Sheets API, PDFKit. See `README.md` for full architecture and feature details.

### Required services

| Service | How to start | Notes |
|---------|-------------|-------|
| PostgreSQL 16 | `docker compose up -d postgres` | Runs on `localhost:5432`, creds `hrbot/hrbot` |
| Redis 7 | `docker compose up -d redis` | Runs on `localhost:6379` |

Docker must be running before starting these services. In the Cloud Agent VM, Docker requires `sudo dockerd` (see setup below).

### Starting Docker in the Cloud Agent VM

```bash
sudo dockerd &>/tmp/dockerd.log &
sleep 3
sudo chmod 666 /var/run/docker.sock
```

### Environment variables

Copy `.env.example` to `.env` and set at least `TELEGRAM_BOT_TOKEN` (min 10 chars). All other services (Groq, Google Sheets, SMTP) are optional and gracefully disabled when not configured. `DATABASE_URL` and `REDIS_URL` default to local Docker Compose values.

### Common dev commands

All commands are documented in `package.json` scripts. Key ones:

- `npm run dev` — starts the bot with `tsx watch` (requires valid `TELEGRAM_BOT_TOKEN`)
- `npm run format:check` / `npm run lint` / `npm run typecheck` — CI-equivalent checks
- `npm test` — runs 36 Vitest unit tests (no external services needed)
- `npm run test:coverage` — tests with v8 coverage
- `npm run build` — `tsc` to `dist/`
- `npm run migrate` — runs `migrations/*.sql` against PostgreSQL
- `npm run seed` — loads 5 demo vacancies from `data/vacancies.json` (idempotent)

### Gotchas

- **Telegram token required at startup**: The bot process will crash if `TELEGRAM_BOT_TOKEN` is invalid. The health server (`/health` on port 8081) starts before `bot.launch()` but the process exits on Telegram auth failure. For testing without a real token, unit tests run fine without any external services.
- **lint-staged@17 requires Node >= 22**: The `lint-staged` dependency warns about Node 20. The project CI uses Node 20 and this does not cause failures, but pre-commit hooks may not work correctly on Node 20. Unit tests, linting, and builds are unaffected.
- **Migrations are idempotent**: All DDL uses `IF NOT EXISTS`. Running `npm run migrate` multiple times is safe.
- **Seeding is idempotent**: `npm run seed` only inserts demo vacancies if the table is empty.
- **Node version**: Use Node.js 20 via nvm (`nvm use 20`). The `engines` field in `package.json` specifies `>=20`.
