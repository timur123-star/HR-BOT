import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { config } from "../src/config.js";

const { Pool } = pg;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: config.db.url });
  const dir = path.resolve("migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    console.log(`[migrate] running ${file}`);
    await pool.query(sql);
  }
  await pool.end();
  console.log("[migrate] done");
}

main().catch((err: unknown) => {
  console.error("[migrate] failed", err);
  process.exit(1);
});
