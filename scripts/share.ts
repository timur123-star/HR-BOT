/**
 * Генерирует deep-link на бота с предвыбранной вакансией.
 *
 * Использование:
 *   npm run share -- 2
 *   → https://t.me/<bot_username>?start=vac_2
 *
 * Требует TELEGRAM_BOT_TOKEN в .env (использует Telegram API чтобы узнать username бота).
 */
import { Telegraf } from "telegraf";
import { config } from "../src/config.js";

async function main(): Promise<void> {
  const arg = process.argv[2];
  const vacancyId = Number(arg);
  if (!Number.isInteger(vacancyId) || vacancyId <= 0) {
    console.error("Usage: npm run share -- <vacancy_id>");
    console.error("Example: npm run share -- 2");
    process.exit(1);
  }

  const bot = new Telegraf(config.telegram.botToken);
  const me = await bot.telegram.getMe();
  const link = `https://t.me/${me.username}?start=vac_${vacancyId}`;
  console.log(link);
}

main().catch((err: unknown) => {
  console.error("Failed:", err);
  process.exit(1);
});
