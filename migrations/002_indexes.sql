-- Дополнительные индексы под реальные запросы из admin.ts / db.ts.
-- Все CREATE INDEX используют IF NOT EXISTS, миграция идемпотентна.

-- /search <name> — ILIKE по candidate_name. Берёт trigram-индекс, чтобы
-- LIKE '%query%' не делал sequential scan. pg_trgm — встроенное расширение
-- Postgres начиная с 13.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_interviews_candidate_name_trgm
  ON interviews USING GIN (candidate_name gin_trgm_ops);

-- /results — getRecentInterviews пагинирует по created_at DESC, индекс уже
-- есть из 001, но добавим композитный (vacancy_id, created_at) для будущих
-- per-vacancy фильтров.
CREATE INDEX IF NOT EXISTS idx_interviews_vacancy_created
  ON interviews(vacancy_id, created_at DESC);

-- listActiveVacancies — частичный индекс по is_active = true, чтобы /start
-- выбирал активные вакансии без чтения деактивированных.
CREATE INDEX IF NOT EXISTS idx_vacancies_active
  ON vacancies(id) WHERE is_active = true;

-- /stats — FILTER по recommendation. Опциональный, помогает при тысячах
-- интервью.
CREATE INDEX IF NOT EXISTS idx_interviews_recommendation
  ON interviews(recommendation);
