import fs from "node:fs";
import path from "node:path";
import { pool } from "./db.js";
import { logger } from "./logger.js";

interface SeedQuestion {
  text: string;
  criteria: string;
}
interface SeedVacancy {
  title: string;
  description: string;
  questions: SeedQuestion[];
}

/**
 * Идемпотентно прогоняет все .sql-файлы из migrations/ при старте.
 * Все DDL написаны с `IF NOT EXISTS`, так что безопасно вызывать на каждый запуск.
 */
export async function runMigrations(): Promise<void> {
  const candidates = [path.resolve("migrations"), path.resolve(process.cwd(), "migrations")];
  const dir = candidates.find((p) => fs.existsSync(p));
  if (!dir) {
    logger.warn("migrations/ directory not found, skipping migrations");
    return;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    logger.warn("No .sql files found in migrations/, skipping");
    return;
  }
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    logger.info(`Running migration: ${file}`);
    await pool.query(sql);
  }
  logger.info("Migrations complete");
}

/**
 * Сидинг 3 демо-вакансий из data/vacancies.json — только если таблица пустая.
 * Если рекрутер уже добавил свои вакансии через /add_vacancy, сидинг пропускается.
 */
export async function seedVacanciesIfEmpty(): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM vacancies"
  );
  if (Number(rows[0].count) > 0) {
    logger.info("Vacancies already present, skipping seed");
    return;
  }

  const candidates = [
    path.resolve("data", "vacancies.json"),
    path.resolve(process.cwd(), "data", "vacancies.json"),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    logger.warn("data/vacancies.json not found, skipping seed");
    return;
  }

  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as SeedVacancy[];
  for (const v of raw) {
    const inserted = await pool.query<{ id: number }>(
      "INSERT INTO vacancies (title, description, is_active) VALUES ($1, $2, true) RETURNING id",
      [v.title, v.description]
    );
    const vacancyId = inserted.rows[0].id;

    let order = 1;
    for (const q of v.questions) {
      await pool.query(
        "INSERT INTO questions (vacancy_id, order_num, text, criteria) VALUES ($1, $2, $3, $4)",
        [vacancyId, order, q.text, q.criteria]
      );
      order += 1;
    }
    logger.info(`Seeded vacancy: ${v.title} (#${vacancyId}) with ${v.questions.length} questions`);
  }
}
