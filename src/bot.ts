import { Telegraf } from "telegraf";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { closeDb } from "./db.js";
import { closeRedis } from "./session.js";
import {
  cancelInterview,
  handleStart,
  handleText,
  registerInterviewHandlers,
} from "./interview.js";
import { registerAdminHandlers } from "./admin.js";
import { ensureSheetsLayout } from "./reporter.js";
import { runMigrations, seedVacanciesIfEmpty } from "./startup.js";
import { checkRate } from "./ratelimit.js";
import { startHealthServer, stopHealthServer } from "./health.js";

const bot = new Telegraf(config.telegram.botToken);

bot.start(async (ctx) => {
  // Защита от спама /start — не больше 5 раз в минуту на пользователя.
  const tgId = ctx.from?.id;
  if (tgId && !(await checkRate(tgId, "start", 5, 60))) {
    await ctx.reply("Слишком много запросов. Подождите минуту и попробуйте снова.");
    return;
  }
  await handleStart(ctx);
});

bot.help(async (ctx) => {
  const isAdmin = config.telegram.adminUserId === ctx.from?.id;
  const candidate =
    "🤖 *HR\\-бот* — короткое автоматическое интервью с AI\\-оценкой\\.\n\n" +
    "*Команды:*\n" +
    "• /start — выбрать вакансию и начать\n" +
    "• /cancel — прервать текущее интервью\n" +
    "• /help — эта справка\n\n" +
    "Все оценки скрыты от вас и видны только рекрутеру\\.";
  const admin = !isAdmin
    ? ""
    : "\n\n*Команды рекрутера:*\n" +
      "• /vacancies — список активных вакансий\n" +
      "• /add\\_vacancy — добавить новую вакансию\n" +
      "• /results — последние 10 интервью\n" +
      "• /search — поиск по имени кандидата\n" +
      "• /export — ссылка на Google Sheets\n" +
      "• /stats — сводная статистика";
  await ctx.reply(candidate + admin, { parse_mode: "MarkdownV2" });
});

bot.command("cancel", async (ctx) => {
  await cancelInterview(ctx);
});

registerAdminHandlers(bot);
registerInterviewHandlers(bot);

bot.on("text", async (ctx) => {
  await handleText(ctx, ctx.message.text);
});

bot.catch(async (err, ctx) => {
  logger.error("Bot error", { error: String(err), update: ctx.updateType });
  // Кандидат не должен видеть «тишину» — даём понятное сообщение и подсказку
  // как восстановиться. Сам ctx.reply может тоже упасть (например, если сорвалась
  // сессия) — оборачиваем в try/catch, чтобы не задвоить ошибку в логе.
  try {
    await ctx.reply(
      "Что-то пошло не так на нашей стороне. Попробуйте /start — это начнёт интервью заново."
    );
  } catch {
    // ignore: вторичная ошибка отправки уже не интересна
  }
});

/**
 * Регистрирует команды бота в Telegram — они появляются в меню рядом
 * с полем ввода (синяя иконка слева). Без этого пользователи не знают
 * что есть /cancel и /help.
 */
async function configureBotMetadata(): Promise<void> {
  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Выбрать вакансию и начать интервью" },
      { command: "cancel", description: "Прервать текущее интервью" },
      { command: "help", description: "Справка" },
    ]);
    if (config.telegram.adminUserId) {
      await bot.telegram.setMyCommands(
        [
          { command: "start", description: "Главное меню" },
          { command: "vacancies", description: "Список активных вакансий" },
          { command: "add_vacancy", description: "Добавить новую вакансию" },
          { command: "results", description: "Последние 10 интервью" },
          { command: "search", description: "Поиск по имени кандидата" },
          { command: "stats", description: "Статистика воронки" },
          { command: "export", description: "Открыть Google Sheets" },
          { command: "help", description: "Справка" },
        ],
        { scope: { type: "chat", chat_id: config.telegram.adminUserId } }
      );
    }
    await bot.telegram.setMyDescription(
      "HR-бот для первичного скрининга кандидатов. AI оценивает развёрнутые ответы, " +
        "результаты падают в Google Sheets с цветовой меткой Нанять/Доп.интервью/Отказать."
    );
    await bot.telegram.setMyShortDescription(
      "AI-скрининг кандидатов: 5 вопросов → оценка → строка в Google Sheets."
    );
    logger.info("Bot metadata configured (commands + description)");
  } catch (err) {
    logger.warn("Failed to configure bot metadata", { error: String(err) });
  }
}

async function main(): Promise<void> {
  logger.info("Starting HR-bot", {
    groq: config.groq.enabled,
    sheets: config.sheets.enabled,
    email: config.email.enabled,
    admin: Boolean(config.telegram.adminUserId),
  });

  await runMigrations();
  await seedVacanciesIfEmpty();

  if (config.sheets.enabled) {
    await ensureSheetsLayout();
  } else {
    logger.warn(
      "Google Sheets disabled — set GOOGLE_SHEET_ID and GOOGLE_CREDENTIALS_JSON/_FILE to enable."
    );
  }

  await configureBotMetadata();
  await startHealthServer(config.runtime.healthPort);

  // dropPendingUpdates сбрасывает накопившиеся апдейты при рестарте и заодно
  // устраняет 409 Conflict, который возникает на стыке деплоев Railway, когда
  // два инстанса коротко полят одновременно.
  if (config.webhook.enabled) {
    await bot.launch({
      dropPendingUpdates: true,
      webhook: {
        domain: config.webhook.url,
        port: config.webhook.port,
        secretToken: config.webhook.secret || undefined,
      },
    });
    logger.info("Bot started in webhook mode", {
      url: config.webhook.url,
      port: config.webhook.port,
    });
  } else {
    await bot.launch({ dropPendingUpdates: true });
    logger.info("Bot started in long-polling mode");
  }
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down`);
  bot.stop(signal);
  await Promise.allSettled([closeDb(), closeRedis(), stopHealthServer()]);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err: unknown) => {
  logger.error("Fatal startup error", { error: String(err) });
  process.exit(1);
});
