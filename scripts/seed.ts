import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { config } from "../src/config.js";

interface SeedQuestion {
  text: string;
  criteria: string;
}
interface SeedVacancy {
  title: string;
  description: string;
  questions: SeedQuestion[];
}

const { Pool } = pg;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: config.db.url });
  const file = path.resolve("data", "vacancies.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as SeedVacancy[];

  for (const v of raw) {
    const existing = await pool.query<{ id: number }>("SELECT id FROM vacancies WHERE title = $1", [
      v.title,
    ]);
    let vacancyId: number;
    if (existing.rows.length > 0) {
      vacancyId = existing.rows[0].id;
      console.log(`[seed] vacancy '${v.title}' exists (#${vacancyId}), refreshing questions`);
      await pool.query("DELETE FROM questions WHERE vacancy_id = $1", [vacancyId]);
    } else {
      const inserted = await pool.query<{ id: number }>(
        "INSERT INTO vacancies (title, description, is_active) VALUES ($1, $2, true) RETURNING id",
        [v.title, v.description]
      );
      vacancyId = inserted.rows[0].id;
      console.log(`[seed] vacancy '${v.title}' added (#${vacancyId})`);
    }

    let order = 1;
    for (const q of v.questions) {
      await pool.query(
        "INSERT INTO questions (vacancy_id, order_num, text, criteria) VALUES ($1, $2, $3, $4)",
        [vacancyId, order, q.text, q.criteria]
      );
      order += 1;
    }
  }

  await pool.end();
  console.log("[seed] done");
}

main().catch((err: unknown) => {
  console.error("[seed] failed", err);
  process.exit(1);
});
