# Changelog

Все заметные изменения в этом проекте документируются в этом файле.
Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).

## [0.5.0]

### Добавлено

- **`src/format.ts`** — общий модуль с `escapeMd`, `progressBar`, `textBar`,
  `formatDateShort`, `formatDateFull`, `redactPii`. Убирает дублирование
  между `admin.ts` и `interview.ts`. Покрыт 13 unit-тестами.
- **PII-редакция в логах** — имена / Telegram handle / телефоны кандидатов
  маскируются в `logger.ts` перед уходом в stdout / Sentry
  (`Иван Петров` → `И*** П***`).
- **Команда `/search <имя>`** для админа — поиск интервью по части имени
  через ILIKE + trigram-индекс.
- **`migrations/002_indexes.sql`** — `pg_trgm` GIN индекс для `/search`,
  композитный `(vacancy_id, created_at)`, частичный по `is_active = true`,
  индекс по `recommendation` для `/stats`.
- **`bot.catch`** теперь отвечает кандидату дружелюбным сообщением вместо
  тишины, не задвоит ошибку при повторном fail.
- **`/help` админа** содержит `/search` в списке команд; `setMyCommands`
  для админ-scope тоже включает её.
- **`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`** —
  портфолио-гигиена.

### Изменено

- Полностью переписан **`README.md`** в стиле остальных репозиториев
  портфолио: `About this project`, секции «Опыт кандидата / рекрутёра /
  production-обвес», таблица стека, companion-проекты, disclaimer.
- `admin.ts` и `interview.ts` импортируют helpers из `format.ts` —
  больше нет дубликата `escapeMd` / `bar` / `progressBar`.

## [0.4.0] — Polish v5

### Добавлено

- **Health endpoint** (`/health`, `/healthz`) — простой HTTP-сервер на отдельном порту
  (`HEALTH_PORT`, дефолт 8081). Используется в Docker HEALTHCHECK и k8s probes.
  Возвращает JSON `{status, uptime, groq, sheets}`.
- **Docker Compose healthcheck** для bot контейнера через `wget --spider`.
- **Pagination для `/results`** — admin может пролистывать историю интервью
  кнопками ◀ Назад / Вперёд ▶ (по 10 на страницу). Заголовок показывает
  `Интервью 11–20 из 47 (стр. 2/5)`.
- **Code coverage** в CI: `@vitest/coverage-v8` генерирует HTML+lcov+json-summary
  отчёты, артефакт загружается в GitHub Actions. Пороги покрытия настроены
  консервативно (интеграционные модули не покрываются в CI).
- **CI-бейджи в README** (build status, Node, TypeScript, License, Prettier style).
- **Dependabot** для npm/github-actions/docker — авто-PR на обновления безопасности.
- **GitHub issue templates** (bug_report, feature_request).
- **+4 теста для `health.ts`**: 200 на /health и /healthz, 404 на other paths,
  идемпотентность start. Всего **23 теста** (было 19).

## [0.3.0] — Polish v4

### Добавлено

- **Prettier + Husky + lint-staged** — pre-commit хук автоматически прогоняет prettier+eslint
  на стейджнутых файлах. Невозможно закоммитить плохо отформатированный код.
- `npm run format` / `npm run format:check` — автоматическое форматирование + проверка в CI.
- **5 демо-вакансий** (было 3): добавлены Product дизайнер и Project Manager — показывает,
  что бот работает не только для IT, но и для дизайна / менеджмента.
- **Webhook режим** опционально через `WEBHOOK_URL` / `WEBHOOK_PORT` / `WEBHOOK_SECRET` —
  для production-scale (10× больше rps чем у long-polling).
- **`npm run share -- <id>`** — CLI-генератор deep-link на конкретную вакансию.
- CI теперь проверяет форматирование (`format:check`) первым шагом перед lint.

## [0.2.1] — Polish v3

### Добавлено

- **`setMyCommands`** + **`setMyDescription`** + **`setMyShortDescription`** — команды
  видны в menu Telegram (синяя иконка слева от поля ввода), описание бота в профиле.
- **Deep-link `/start vac_5`** — открывает конкретную вакансию по ссылке (для рассылки).
- **Resume интервью** — если кандидат закрыл Telegram посередине, `/start` предложит
  «▶️ Продолжить с вопроса N» или «🔄 Начать заново».
- **Rate-limit** `/start` (5/мин на пользователя) через Redis INCR+EXPIRE.
- **LICENSE** (MIT, с упоминанием Apache 2.0 для bundled Roboto) + **CHANGELOG.md**.
- 4 новых теста для `checkRate` (fail-open при сбое Redis).

## [0.2.0] — Polish v2

### Добавлено
- **Google Sheets форматирование**: жирные цветные заголовки, заморозка первой строки,
  фиксированные ширины колонок, wrap-text в AI-резюме, banding для строк.
- **Conditional formatting** по колонке «Рекомендация»: зелёный/жёлтый/красный фон.
- **HYPERLINK** в колонке «Контакт» — `Открыть чат →`.
- Лист «Кандидаты» автоматически переносится на первую позицию, дефолтный «Лист1»
  удаляется если он пуст.
- Переработанный лист «Статистика» с разделами «Сводка», «ТОП-5», «По вакансиям».
- **Кириллический PDF**: Roboto-Regular + Roboto-Bold (TTF Apache 2.0), цветной хедер,
  бэйдж рекомендации, нумерация страниц.
- **Telegram UX**: typing-indicator во время AI-оценки, ротация фраз подтверждения,
  меню с описаниями вакансий, ошибка короткого ответа с длиной, MarkdownV2 везде.
- **`/cancel`** — прервать интервью в любой момент.
- **`/help`** — справка с разными командами для админа и кандидата.
- Кнопка **«🔁 Другая вакансия»** после завершения.
- **Deep-link** `/start vac_5` — открыть конкретную вакансию по ссылке.
- **Resume**: если есть незавершённая сессия — бот предложит продолжить или начать заново.
- **Rate-limit** `/start` (5/мин на пользователя) через Redis.
- **`setMyCommands`** — команды появляются в меню Telegram (синяя иконка слева).
- **`setMyDescription` + `setMyShortDescription`** — описание бота в Telegram.
- **Admin-уведомления**: после интервью админу приходит сообщение + PDF + кнопка на Sheet.
- **`/vacancies`** с инлайн-кнопками деактивации.
- **`/stats`** с текстовыми барами визуализации.
- **`/results`** с эмодзи-метками рекомендации.
- README с архитектурной диаграммой и таблицей фич.
- LICENSE (MIT) + CHANGELOG.

### Исправлено
- 409 Conflict при пересборке Railway → `dropPendingUpdates: true`.
- Groq-вызовы повторяются один раз при сбое.
- safeBatch для запросов Sheets-формата — повторные запуски не падают на «уже существует».

## [0.1.0] — Initial release

### Добавлено
- Telegraf 4 + TypeScript strict scaffold.
- 3 демо-вакансии (Frontend, Backend, Менеджер продаж) с 5 вопросами каждая.
- Groq AI оценка ответов + итоговое резюме с рекомендацией.
- Postgres схема: vacancies, questions, interviews (JSONB).
- Redis сессии с TTL.
- Google Sheets интеграция (листы «Кандидаты» и «Статистика»).
- PDF-генерация + опциональная отправка SMTP.
- Docker Compose (Postgres + Redis + bot).
- Авто-миграции и idempotent seed при старте.
- GitHub Actions CI (lint + typecheck + build + test).
- 15 unit-тестов.
