# Contributing

Это портфолио-проект, но pull-request'ы и issue приветствуются. Несколько правил, которые сэкономят время.

## Локальный стенд

```bash
npm install
cp .env.example .env
# заполнить TELEGRAM_BOT_TOKEN
npm run migrate
npm run seed
npm run dev
```

Если хочется поднять Postgres + Redis + бота одной командой:

```bash
docker compose up --build
```

## Перед коммитом

Husky pre-commit хук уже настроен и автоматически прогоняет Prettier + ESLint на стейджнутых файлах через `lint-staged`. Если запускаешь руками:

```bash
npm run format         # prettier --write
npm run lint           # eslint strict
npm run typecheck      # tsc --noEmit
npm test               # vitest run — все unit-тесты
```

CI повторяет ту же цепочку и дополнительно собирает coverage-отчёт (`npm run test:coverage`).

## Стиль кода

- **TypeScript strict.** Никаких `any`, `getattr`, `as unknown as`. Если приходится — значит, тип ещё не понят.
- **Prettier — единственный источник истины** по форматированию (`.prettierrc.json`). Не спорим про точки с запятыми и ширину строки.
- **ESLint** настроен на strict TypeScript + неиспользованные импорты. Любая ошибка падает в CI.
- **Комментарии.** По умолчанию — без комментариев, имена сами должны быть понятны. Если без комментария всё-таки нужен — он описывает _что делает код_, а не «что изменилось» (для этого есть git log).
- **Импорты — наверху файла**, после `import` сразу идёт пустая строка и потом код.

## Тесты

Юнит-тесты живут в `tests/*.test.ts`, используют Vitest. Покрываем _критическую_ логику без зависимостей от внешних сервисов:

- `evaluator.ts` (parsing JSON-ответа Groq, retry-логика)
- `ratelimit.ts` (Redis-моки)
- `interview.ts` (FSM-переходы)
- `health.ts` (HTTP-эндпоинты)
- `format.ts` (helpers)

Интеграционные модули (`db.ts`, `reporter.ts`, `session.ts`) требуют живых Postgres / Redis / Sheets — в CI они не запускаются. При желании можно покрыть через testcontainers, но это вне scope MVP.

## Сообщения коммитов

```
feat: …    — новая фича
fix: …     — баг
docs: …    — только документация
chore: …   — конфиги, зависимости
refactor: …— рефакторинг без поведения
test: …    — только тесты
```

## Pull request

Опиши **что** и **зачем** меняешь. Скриншот / лог из Railway — большой плюс, если меняется UI Telegram или Google Sheets. CI должен быть зелёным до ревью.
