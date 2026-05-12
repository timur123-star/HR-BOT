import pg from "pg";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { AnswerRecord, InterviewResult, Question, Recommendation, Vacancy } from "./types.js";

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.db.url });

pool.on("error", (err: Error) => {
  logger.error("Postgres pool error", { error: err.message });
});

export async function listActiveVacancies(): Promise<Vacancy[]> {
  const { rows } = await pool.query<Vacancy>(
    "SELECT id, title, description, is_active FROM vacancies WHERE is_active = true ORDER BY id"
  );
  return rows;
}

export async function getVacancy(id: number): Promise<Vacancy | null> {
  const { rows } = await pool.query<Vacancy>(
    "SELECT id, title, description, is_active FROM vacancies WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function getQuestions(vacancyId: number): Promise<Question[]> {
  const { rows } = await pool.query<Question>(
    "SELECT id, vacancy_id, order_num, text, criteria FROM questions WHERE vacancy_id = $1 ORDER BY order_num",
    [vacancyId]
  );
  return rows;
}

export async function addVacancy(title: string, description: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO vacancies (title, description, is_active) VALUES ($1, $2, true) RETURNING id",
    [title, description]
  );
  return rows[0].id;
}

export async function addQuestion(
  vacancyId: number,
  orderNum: number,
  text: string,
  criteria: string
): Promise<void> {
  await pool.query(
    "INSERT INTO questions (vacancy_id, order_num, text, criteria) VALUES ($1, $2, $3, $4)",
    [vacancyId, orderNum, text, criteria]
  );
}

export async function hasCompletedInterview(
  candidateTg: string,
  vacancyId: number
): Promise<boolean> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM interviews WHERE candidate_tg = $1 AND vacancy_id = $2",
    [candidateTg, vacancyId]
  );
  return Number(rows[0].count) > 0;
}

export interface SaveInterviewParams {
  candidateName: string;
  candidateTg: string;
  vacancyId: number;
  answers: AnswerRecord[];
  totalScore: number;
  aiSummary: string;
  recommendation: Recommendation;
  status: "completed" | "incomplete";
}

export async function saveInterview(params: SaveInterviewParams): Promise<number> {
  const answersJson: Record<number, AnswerRecord> = {};
  for (const a of params.answers) answersJson[a.question_id] = a;

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO interviews
       (candidate_name, candidate_tg, vacancy_id, answers, total_score, ai_summary, recommendation, status)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
     RETURNING id`,
    [
      params.candidateName,
      params.candidateTg,
      params.vacancyId,
      JSON.stringify(answersJson),
      params.totalScore,
      params.aiSummary,
      params.recommendation,
      params.status,
    ]
  );
  return rows[0].id;
}

export async function countInterviews(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM interviews`);
  return Number(rows[0]?.n ?? 0);
}

export async function getRecentInterviews(limit = 10, offset = 0): Promise<InterviewResult[]> {
  const { rows } = await pool.query<{
    id: number;
    candidate_name: string;
    candidate_tg: string;
    vacancy_id: number;
    vacancy_title: string;
    answers: Record<number, AnswerRecord>;
    total_score: number;
    ai_summary: string;
    recommendation: Recommendation;
    status: "completed" | "incomplete";
    created_at: Date;
  }>(
    `SELECT i.id, i.candidate_name, i.candidate_tg, i.vacancy_id, v.title AS vacancy_title,
            i.answers, i.total_score, i.ai_summary, i.recommendation, i.status, i.created_at
       FROM interviews i
       JOIN vacancies v ON v.id = i.vacancy_id
      ORDER BY i.created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return rows.map((r) => ({
    id: r.id,
    candidate_name: r.candidate_name,
    candidate_tg: r.candidate_tg,
    vacancy_id: r.vacancy_id,
    vacancy_title: r.vacancy_title,
    answers: Object.values(r.answers ?? {}),
    total_score: r.total_score,
    ai_summary: r.ai_summary,
    recommendation: r.recommendation,
    status: r.status,
    created_at: r.created_at,
  }));
}

export async function searchInterviewsByName(
  query: string,
  limit = 20
): Promise<InterviewResult[]> {
  const { rows } = await pool.query<{
    id: number;
    candidate_name: string;
    candidate_tg: string;
    vacancy_id: number;
    vacancy_title: string;
    answers: Record<number, AnswerRecord>;
    total_score: number;
    ai_summary: string;
    recommendation: Recommendation;
    status: "completed" | "incomplete";
    created_at: Date;
  }>(
    `SELECT i.id, i.candidate_name, i.candidate_tg, i.vacancy_id, v.title AS vacancy_title,
            i.answers, i.total_score, i.ai_summary, i.recommendation, i.status, i.created_at
       FROM interviews i
       JOIN vacancies v ON v.id = i.vacancy_id
      WHERE i.candidate_name ILIKE $1
      ORDER BY i.created_at DESC
      LIMIT $2`,
    [`%${query}%`, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    candidate_name: r.candidate_name,
    candidate_tg: r.candidate_tg,
    vacancy_id: r.vacancy_id,
    vacancy_title: r.vacancy_title,
    answers: Object.values(r.answers ?? {}),
    total_score: r.total_score,
    ai_summary: r.ai_summary,
    recommendation: r.recommendation,
    status: r.status,
    created_at: r.created_at,
  }));
}

export interface StatsSummary {
  today: number;
  thisWeek: number;
  total: number;
  avgScore: number;
}

export async function getStats(): Promise<StatsSummary> {
  const { rows } = await pool.query<{
    today: string;
    week: string;
    total: string;
    avg: string | null;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::text AS today,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::text AS week,
       COUNT(*)::text AS total,
       COALESCE(AVG(total_score), 0)::text AS avg
     FROM interviews
     WHERE status = 'completed'`
  );
  const r = rows[0];
  return {
    today: Number(r.today),
    thisWeek: Number(r.week),
    total: Number(r.total),
    avgScore: Number(r.avg ?? 0),
  };
}

export async function setVacancyActive(id: number, isActive: boolean): Promise<void> {
  await pool.query("UPDATE vacancies SET is_active = $1 WHERE id = $2", [isActive, id]);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
