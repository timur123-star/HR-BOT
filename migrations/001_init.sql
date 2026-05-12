CREATE TABLE IF NOT EXISTS vacancies (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id         SERIAL PRIMARY KEY,
  vacancy_id INT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  order_num  INT NOT NULL,
  text       TEXT NOT NULL,
  criteria   TEXT NOT NULL DEFAULT 'Глубина и конкретика ответа.'
);

CREATE INDEX IF NOT EXISTS idx_questions_vacancy ON questions(vacancy_id, order_num);

CREATE TABLE IF NOT EXISTS interviews (
  id              SERIAL PRIMARY KEY,
  candidate_name  TEXT NOT NULL,
  candidate_tg    TEXT NOT NULL,
  vacancy_id      INT NOT NULL REFERENCES vacancies(id),
  answers         JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_score     INT NOT NULL DEFAULT 0,
  ai_summary      TEXT NOT NULL DEFAULT '',
  recommendation  TEXT NOT NULL DEFAULT 'Доп.интервью',
  status          TEXT NOT NULL DEFAULT 'completed',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Защита от повторного прохождения одной и той же вакансии одним кандидатом.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_interview_tg_vacancy
  ON interviews(candidate_tg, vacancy_id);

CREATE INDEX IF NOT EXISTS idx_interviews_created_at ON interviews(created_at DESC);
