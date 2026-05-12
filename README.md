# HR-BOT — автоматический скрининг кандидатов в Telegram

Telegram-бот, который заменяет первичный получасовой созвон HR с каждым кандидатом на пятиминутное автоматическое интервью. Кандидат проходит 5 вопросов в чате, LLM оценивает ответы по критериям вакансии, и каждый кандидат строкой попадает в Google Sheets с цветовой меткой и кликабельной ссылкой на чат. Portfolio piece.

`Node 20` · `Telegraf 4` · `Groq (Llama 3.3 70B)` · `PostgreSQL` · `Redis` · `Google Sheets API` · `PDFKit`

[![CI](https://github.com/timur123-star/HR-BOT/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/timur123-star/HR-BOT/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Telegraf](https://img.shields.io/badge/Telegraf-4-26A5E4?logo=telegram&logoColor=white)](https://telegraf.js.org/)
[![Postgres](https://img.shields.io/badge/Postgres-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Vitest](https://img.shields.io/badge/tests-vitest%20%C2%B7%2036-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%20%C2%B7%20strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://prettier.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[Source](https://github.com/timur123-star/HR-BOT) · [Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md)

---

## About this project

HR-BOT — портфолио-проект: автоматизированная воронка первичного скрининга, в которой вся работа рекрутёра сводится к открытию знакомой Google-таблицы. Кандидат заходит в Telegram-бота по deep-link с вакансии, проходит интервью с прогрессом, LLM оценивает каждый ответ по `criteria` вопроса, и в Sheets сразу появляется готовая к фильтрации строка: имя, балл, рекомендация, цвет, ссылка на чат.

Каждый модуль, миграция, тест и блок документации написан вручную: ни ноу-кодов, ни copy-paste из туториалов, ни заглушек «MVP в выходные». Стек как у боевого Telegram-сервиса, но компактный — один бот, один Postgres, один Redis, одна таблица. Все «production must-have» — health-эндпоинт, idempotent миграции, rate-limit, drop-pending-updates, dependabot, coverage в CI — закрыты и проверяются на каждом пуше.

> **Disclaimer.** Демо-вакансии, вопросы и критерии оценки (`data/vacancies.json`) — fictional и подобраны исключительно как стартовый набор для портфолио. На любую реальную вакансию переезжается за минуту через `/add_vacancy`. Сам код переносится на любой Telegram-канал найма без правок.
>
> Designed and built by **Тимур Валерьевич**.

> **Companion-проекты.** Этот бот — backend-кусок моего портфолио. Соседние работы:
>
> - **AI-консультант для онлайн-магазина** — Telegram-бот с RAG и Groq для розницы →
>   [source](https://github.com/timur123-star/AI-consultant-for-the-store)
> - **NOVA Agency** — маркетинговый сайт студии (Next.js 14 + Tailwind + Framer Motion) →
>   [source](https://github.com/timur123-star/Landing-page-for-an-agency)
> - **Lumen Analytics** — login-gated multilingual SaaS-дашборд →
>   [source](https://github.com/timur123-star/Lumen-Analytics)

---

## Что внутри

### Опыт кандидата

- **Один `/start` — и поехали.** Бот выводит список активных вакансий с коротким описанием под каждой кнопкой; deep-link `t.me/<bot>?start=vac_<id>` сразу открывает нужную позицию.
- **Прогресс-бар на каждом шаге.** `Вопрос 2 из 5 ▓▓░░░` — кандидат видит, сколько ещё осталось, и не теряет интерес.
- **Resume интервью.** Если кандидат закрыл Telegram посередине, новый `/start` предлагает «Продолжить с вопроса N» или «Начать заново».
- **Скрытые оценки.** Балл, рекомендация и AI-резюме видит только рекрутёр. Кандидат не подстраивается под систему — отвечает честнее.
- **«Печатает…» во время LLM-вызова.** `sendChatAction` показывает индикатор пока Groq оценивает ответ, чтобы кандидат не подумал, что бот завис.
- **Ротация подтверждений.** «Принято, спасибо», «Понял, идём дальше», «Записал. Следующий:» — пять фраз чередуются, диалог не выглядит шаблонно.
- **Минимальная длина ответа.** 20 символов на ответ + понятная ошибка с показом текущей/требуемой длины.
- **`/cancel` и `/help`.** Кандидат может прерваться в любой момент. `/help` показывает справку, рекрутёру дополнительно подгружаются команды админа в персональный chat scope через `setMyCommands`.
- **`setMyDescription` + `setMyShortDescription`** — карточка бота в Telegram выглядит профессионально без ручного захода в BotFather.

### Опыт рекрутёра

- **Google Sheets как UI.** Главная фича — лист «Кандидаты» открывается первым, дефолтный «Лист1» удаляется автоматически. Жирный цветной заголовок, замороженная первая строка, банды для нечётных рядов, ширины колонок выставлены под содержимое.
- **Условное цветовое кодирование.** «Нанять» — зелёный, «Доп.интервью» — жёлтый, «Отказать» — красный. Глазом находишь топ-кандидатов за секунду, фильтры/сортировка не нужны.
- **Кликабельная колонка «Контакт».** `=HYPERLINK("https://t.me/<user>","Открыть чат →")` — один клик и ты в диалоге с кандидатом.
- **Лист «Статистика» с формулами.** Воронка (всего/за неделю/сегодня), средний балл, разбивка по вакансиям, ТОП-5 кандидатов через `QUERY`. Всё считается формулами, бот не пересчитывает значения сам.
- **Кириллический PDF-отчёт.** Roboto-Regular/Bold embed (никаких квадратов на месте русских букв), цветной хедер, бэйдж рекомендации, номера страниц. Отправляется опционально на `RECRUITER_EMAIL` и **всегда** приходит админу прямо в Telegram файлом.
- **Опциональный email.** Без `SMTP_*` бот тихо пропускает рассылку — PDF лежит локально в `reports/`. С SMTP (Gmail App Password / Mailgun / любой) — улетает рекрутёру вместе со ссылкой на Sheets.
- **`/results` с пагинацией.** `◀ Назад / Вперёд ▶`, заголовок «Интервью 11–20 из 47 (стр. 2/5)».
- **`/search <имя>`** — быстрый поиск по имени кандидата через trigram-индекс (`pg_trgm`).
- **`/stats` с текстовыми барами.** Воронка отображается без графиков и зависимостей — `██████░░░░` рядом с цифрой.
- **`/vacancies`, `/add_vacancy`, `/export`.** Список активных вакансий с кнопками деактивации; добавление новой вакансии в один paste; ссылка на Sheets.

### Production-обвес

- **HTTP `/health` + `/healthz`** на отдельном порту `HEALTH_PORT` (8081). Возвращает `{status, uptime, groq, sheets}`. Готово для Docker `HEALTHCHECK`, Kubernetes liveness/readiness, Railway/Render healthcheck.
- **Авто-миграции + idempotent сидинг при старте.** Контейнер на любом PaaS пересоздаётся — `runMigrations()` прогоняет `migrations/*.sql` (DDL все с `IF NOT EXISTS`), `seedVacanciesIfEmpty()` загружает 5 демо-вакансий только если БД пустая.
- **PII-редакция в логах.** Имена кандидатов и handle маскируются (`Иван Петров` → `И*** П***`, `@vasya` → `@v***`) перед записью в Railway-логи и Sentry.
- **Rate-limit `/start`** через Redis: 5 нажатий в минуту на user_id, защита от спама.
- **`dropPendingUpdates: true`** при запуске — больше нет 409 Conflict в логах после деплоя Railway.
- **Groq retry-on-fail.** Один повтор при `5xx` с экспоненциальным бэкоффом.
- **Webhook режим опционально.** По умолчанию long-polling, для production-scale `WEBHOOK_URL` + `WEBHOOK_SECRET`.
- **Pre-commit hooks** — Husky + lint-staged: Prettier и ESLint фиксят файлы до коммита.
- **CI matrix** на каждый PR: `format:check` → `lint` → `typecheck` → `build` → `test` → `coverage` (артефакт сохраняется 14 дней).
- **Dependabot** — еженедельно для npm (grouped dev/prod), ежемесячно для GitHub Actions и Docker. Лимит 5 open PR.

---

## Архитектура

```
                       ┌───────────────────────────┐
                       │  Telegram (BotFather API) │
                       └─────────────┬─────────────┘
                                     │ long-polling / webhook
                                     ▼
       ┌────────────────────────────────────────────────────────┐
       │                  src/bot.ts (Telegraf 4)               │
       │  /start · /help · /cancel · rate-limit · setMyCommands │
       └──────────┬─────────────────────────────────┬───────────┘
                  │                                 │
                  ▼                                 ▼
   ┌─────────────────────────┐         ┌─────────────────────────┐
   │  src/interview.ts       │         │   src/admin.ts          │
   │  FSM: ready → in_prog   │         │   /vacancies /stats     │
   │       → done · resume   │         │   /results /search      │
   │  typing-indicator       │         │   /add_vacancy /export  │
   └──────────┬──────────────┘         └────────────┬────────────┘
              │                                     │
              ▼                                     ▼
   ┌──────────────────────────────────────────────────────────────┐
   │            src/evaluator.ts   ·   src/reporter.ts            │
   │  Groq llama-3.3-70b · JSON-mode · retry · Sheets API · PDF   │
   └──────────┬───────────────────────────────────┬───────────────┘
              │                                   │
              ▼                                   ▼
   ┌──────────────────────┐         ┌─────────────────────────────┐
   │  Postgres (db.ts)    │         │  Redis (session.ts)         │
   │  vacancies           │         │  state machine · TTL 3600s  │
   │  questions           │         │  rate-limit counters        │
   │  interviews + idx    │         │                             │
   └──────────────────────┘         └─────────────────────────────┘
```

---

## Стек

| Слой | Инструмент |
| ---------------- | ------------------------------------------------------------------------- |
| Runtime          | [Node.js 20 LTS](https://nodejs.org), TypeScript 5 (`strict`)             |
| Telegram         | [Telegraf 4](https://telegraf.js.org) (`setMyCommands`, MarkdownV2, deep-link) |
| LLM              | [Groq SDK](https://groq.com) — `llama-3.3-70b-versatile`, JSON response_format |
| Persistence      | [PostgreSQL 16](https://www.postgresql.org) + [pg](https://node-postgres.com) + `pg_trgm` |
| Session state    | [Redis 7](https://redis.io) + [node-redis](https://github.com/redis/node-redis) |
| Sheets           | [googleapis](https://github.com/googleapis/google-api-nodejs-client) v4 (formatting, conditional rules, `HYPERLINK`) |
| PDF              | [pdfkit](https://pdfkit.org) + Roboto Cyrillic TTF                        |
| Email            | [nodemailer](https://nodemailer.com) (Gmail / Mailgun / любой SMTP)       |
| Validation       | [zod](https://zod.dev) — runtime-проверка env                             |
| HTTP             | `node:http` — `/health` + webhook (без Express)                           |
| Tests            | [Vitest 2](https://vitest.dev) + `@vitest/coverage-v8` (36 кейсов)        |
| Lint / style     | [ESLint 9](https://eslint.org) + [Prettier](https://prettier.io) + [Husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged) |
| CI               | [GitHub Actions](https://github.com/features/actions) (`format:check` → `lint` → `typecheck` → `build` → `test` → coverage) |
| Container        | `node:20-alpine` + Docker Compose (Postgres + Redis + bot, healthcheck)   |
| Hosting          | [Railway](https://railway.com) / [Render](https://render.com) / any PaaS  |

---

## Быстрый старт

### Локально через Docker Compose

```bash
git clone https://github.com/timur123-star/HR-BOT.git
cd HR-BOT
cp .env.example .env
# минимум — TELEGRAM_BOT_TOKEN. Опционально GROQ_API_KEY, GOOGLE_*, SMTP_*.
docker compose up --build
```

Postgres и Redis поднимутся как сервисы compose, бот сам прогонит миграции и засидит 5 демо-вакансий при первом старте.

### На Railway / Render (production)

1. Подключить репо и выставить переменные окружения из `.env.example`.
2. Railway сам поднимет Postgres и Redis из marketplace; бот при первом запуске прогонит `migrations/*.sql` и засидит `data/vacancies.json`.
3. Открыть `https://<service>.up.railway.app/health` для проверки.

### Локально без Docker

```bash
npm install
npm run migrate
npm run seed
npm run dev
```

---

## Команды

### Кандидат

- `/start` — выбрать вакансию и начать интервью.
- `/start vac_<id>` — deep-link на конкретную вакансию.
- `/cancel` — прервать текущее интервью.
- `/help` — справка.

### Рекрутёр (по `ADMIN_USER_ID`)

- `/vacancies` — активные вакансии с кнопками «Деактивировать».
- `/add_vacancy` — добавить новую вакансию в формате `Title | Description\nQ1: текст | критерии\n…`.
- `/results` — пагинированный список интервью (по 10, кнопки `◀ / ▶`).
- `/search <часть имени>` — поиск по кандидатам (`pg_trgm` ILIKE).
- `/stats` — воронка с текстовыми барами и средним баллом.
- `/export` — кнопка-ссылка на Google Sheets.

---

## Настройка Google Sheets (главная фича)

1. <https://console.cloud.google.com> → новый проект → **APIs & Services → Library → Google Sheets API → Enable**.
2. **Credentials → Create Credentials → Service account** → имя любое → роль пропустить → **Done**.
3. Кликнуть на созданный аккаунт → **Keys → Add Key → Create new key → JSON** → сохранить файл.
4. Содержимое файла одной строкой положить в `GOOGLE_CREDENTIALS_JSON` (или путь к файлу — в `GOOGLE_CREDENTIALS_FILE`).
5. Создать пустую Google-таблицу → **Share** с email из `client_email` (роль Editor).
6. ID таблицы (между `/d/` и `/edit` в URL) положить в `GOOGLE_SHEET_ID`.

Бот сам создаст листы «Кандидаты» и «Статистика», применит форматирование, conditional rules и формулы — без ручной настройки шаблона.

---

## Структура проекта

```
src/
  bot.ts              # entrypoint: миграции, seed, launch (polling / webhook)
  config.ts           # zod-валидация env
  db.ts               # Postgres операции + searchInterviewsByName
  format.ts           # escapeMd / progressBar / textBar / formatDate / redactPii
  health.ts           # HTTP /health + /healthz (node:http)
  interview.ts        # FSM интервью: state machine, typing-indicator, ротация
  evaluator.ts        # Groq evaluation + summary с retry
  reporter.ts         # Sheets layout + append + PDF + email
  admin.ts            # /vacancies /stats /results /search /add_vacancy /export
  ratelimit.ts        # Redis-based rate-limit
  session.ts          # Redis state с TTL 3600s
  startup.ts          # idempotent migrations + seed
  logger.ts           # structured JSON logger + PII redaction
  types.ts            # shared TS types
migrations/
  001_init.sql        # vacancies / questions / interviews + UNIQUE
  002_indexes.sql     # pg_trgm + composite + partial indexes
data/
  vacancies.json      # 5 демо-вакансий с критериями
assets/
  Roboto-*.ttf        # Cyrillic шрифты для PDF
tests/                # 36 unit-тестов на критическую логику
.github/
  workflows/ci.yml    # format → lint → typecheck → build → test → coverage
  dependabot.yml      # weekly npm, monthly GH Actions / Docker
  ISSUE_TEMPLATE/     # bug_report.md, feature_request.md
scripts/
  migrate.ts          # ручной запуск миграций
  seed.ts             # ручной запуск сидера
  share.ts            # генератор deep-link: npm run share -- 2
```

---

## Архитектурные решения

- **Sheets — главный UI, не Telegram.** Рекрутёр не хочет учить новый интерфейс. Google Sheets — общий язык: фильтры, сортировка, шаринг, копи-паст в Notion — всё это уже есть бесплатно.
- **Скрытые оценки.** Если кандидат видит балл, он подстраивается под систему. Скрытая оценка → ответы ближе к реальности → LLM судит по сути.
- **Groq, а не OpenAI.** Free tier, sub-секундная latency на 70B, JSON-mode из коробки. Заменяемо одной строкой в `evaluator.ts`.
- **Idempotent seed.** На Railway контейнер пересоздаётся при каждом деплое — `seedVacanciesIfEmpty` проверяет, что таблица пуста, и только тогда вставляет демо. Свои добавленные через `/add_vacancy` никогда не перезатираются.
- **UNIQUE `(candidate_tg, vacancy_id)`.** Кандидат не может пройти ту же вакансию дважды — попытка возвращает дружелюбное сообщение, в БД не плодятся дубликаты.
- **PII-редакция в логах.** Имя/handle/телефон маскируются перед уходом в stdout / Sentry. Логи Railway безопасно показывать в портфолио.
- **Health-эндпоинт — `node:http`, без Express.** Минимум зависимостей, ~0.1 ms ответ.

---

## CI / тесты

```bash
npm run format         # prettier --write
npm run format:check   # prettier check (первый шаг CI)
npm run lint           # eslint strict
npm run typecheck      # tsc --noEmit
npm test               # vitest run — 36 unit-тестов
npm run test:coverage  # vitest + v8 coverage (HTML + lcov + json-summary)
npm run build          # tsc → dist/
```

GitHub Actions запускает всё на каждый PR. Husky pre-commit прогоняет `prettier --write` + `eslint --fix` на стейджнутых файлах через lint-staged — CI ловит только то, что хук пропустил.

### Deep-link генератор

```bash
npm run share -- 2
# → https://t.me/<your_bot>?start=vac_2
```

### Webhook режим

По умолчанию бот работает в long-polling. Для production-scale задать `WEBHOOK_URL` + `WEBHOOK_SECRET` — бот поднимет HTTP-сервер на `WEBHOOK_PORT` (дефолт 8080) и зарегистрирует webhook в Telegram.

---

## Лицензия

[MIT](./LICENSE). Roboto-Regular / Roboto-Bold — Apache 2.0.

---

Designed and built by **Тимур Валерьевич**.
