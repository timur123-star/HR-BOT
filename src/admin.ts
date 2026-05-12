import { Markup, type Context, type Telegraf } from "telegraf";
import { config } from "./config.js";
import {
  addQuestion,
  addVacancy,
  countInterviews,
  getRecentInterviews,
  getStats,
  listActiveVacancies,
  searchInterviewsByName,
  setVacancyActive,
} from "./db.js";
import { escapeMd, formatDateShort, textBar } from "./format.js";
import { sheetUrl } from "./reporter.js";

const RESULTS_PAGE_SIZE = 10;

function isAdmin(ctx: Context): boolean {
  return config.telegram.adminUserId !== undefined && ctx.from?.id === config.telegram.adminUserId;
}

const pendingAddVacancy = new Set<number>();

const REC_BADGE: Record<string, string> = {
  Нанять: "🟢",
  "Доп.интервью": "🟡",
  Отказать: "🔴",
};

export function registerAdminHandlers(bot: Telegraf): void {
  bot.command("vacancies", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const items = await listActiveVacancies();
    if (items.length === 0) {
      await ctx.reply("Активных вакансий нет\\. Добавьте через /add\\_vacancy\\.", {
        parse_mode: "MarkdownV2",
      });
      return;
    }
    const lines = ["💼 *Активные вакансии*\n"];
    for (const v of items) {
      lines.push(`*\\#${v.id} · ${escapeMd(v.title)}*`);
      if (v.description) lines.push(`_${escapeMd(v.description.slice(0, 200))}_`);
      lines.push("");
    }
    const buttons = items.map((v) => [
      Markup.button.callback(`🚫 Деактивировать #${v.id} ${v.title}`, `vac_off:${v.id}`),
    ]);
    await ctx.reply(lines.join("\n"), {
      parse_mode: "MarkdownV2",
      ...Markup.inlineKeyboard(buttons),
    });
  });

  bot.action(/^vac_off:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery();
      return;
    }
    const id = Number(ctx.match[1]);
    await ctx.answerCbQuery("Деактивирую...");
    await setVacancyActive(id, false);
    await ctx.editMessageText(`Вакансия #${id} деактивирована. Кандидаты больше её не увидят.`, {
      parse_mode: "Markdown",
    });
  });

  bot.command("add_vacancy", async (ctx) => {
    if (!isAdmin(ctx)) return;
    pendingAddVacancy.add(ctx.from!.id);
    await ctx.reply(
      "📝 *Добавление вакансии*\n\n" +
        "Отправьте описание в формате:\n\n" +
        "```\n" +
        "Название \\| Краткое описание для кандидата\n" +
        "Q1: Текст вопроса \\| Критерий оценки\n" +
        "Q2: Текст вопроса \\| Критерий оценки\n" +
        "Q3: Текст вопроса \\| Критерий оценки\n" +
        "```\n\n" +
        "Минимум 1 вопрос, рекомендую 5\\. Команду можно отменить через /cancel\\.",
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.command("results", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await renderResultsPage(ctx, 0);
  });

  bot.action(/^results_page:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery();
      return;
    }
    const page = Math.max(0, Number(ctx.match[1]));
    await ctx.answerCbQuery();
    await renderResultsPage(ctx, page, { edit: true });
  });

  bot.command("export", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const url = sheetUrl();
    if (!url) {
      await ctx.reply("Google Sheets не настроены (нет GOOGLE_SHEET_ID).");
      return;
    }
    await ctx.reply(
      "📊 Таблица с кандидатами — все интервью, оценки, рекомендации и статистика:",
      Markup.inlineKeyboard([Markup.button.url("Открыть таблицу", url)])
    );
  });

  bot.command("stats", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const s = await getStats();
    const maxRef = Math.max(s.thisWeek, s.total, 1);
    const lines = [
      "📈 *Статистика воронки*\n",
      `Сегодня: *${s.today}*  \`${textBar(s.today, maxRef)}\``,
      `За 7 дней: *${s.thisWeek}*  \`${textBar(s.thisWeek, maxRef)}\``,
      `Всего: *${s.total}*  \`${textBar(s.total, maxRef)}\``,
      "",
      `Средний балл: *${escapeMd(s.avgScore.toFixed(1))}/10*  \`${textBar(s.avgScore, 10)}\``,
    ];
    await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2" });
  });

  bot.command("search", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const raw = ctx.message.text.replace(/^\/search(@\S+)?\s*/i, "").trim();
    if (!raw) {
      await ctx.reply(
        "🔎 Использование: `/search <часть имени>`\\.\nНапример: `/search Иван` найдёт всех Иванов\\.",
        { parse_mode: "MarkdownV2" }
      );
      return;
    }
    const items = await searchInterviewsByName(raw, 20);
    if (items.length === 0) {
      await ctx.reply(`Ничего не найдено по запросу «${escapeMd(raw)}»\\.`, {
        parse_mode: "MarkdownV2",
      });
      return;
    }
    const header = `🔎 *Найдено ${items.length} интервью по запросу «${escapeMd(raw)}»*\n`;
    const lines = [header];
    for (const r of items) {
      const badge = REC_BADGE[r.recommendation] ?? "📋";
      const date = formatDateShort(r.created_at);
      lines.push(
        `${badge} *${escapeMd(r.candidate_name)}* · ${escapeMd(r.vacancy_title)}\n` +
          `   ${r.total_score}/10 · ${escapeMd(r.recommendation)} · _${escapeMd(date)}_`
      );
    }
    await ctx.reply(lines.join("\n\n"), { parse_mode: "MarkdownV2" });
  });

  bot.on("text", async (ctx, next) => {
    if (isAdmin(ctx) && pendingAddVacancy.has(ctx.from!.id)) {
      pendingAddVacancy.delete(ctx.from!.id);
      await handleAddVacancyPayload(ctx, ctx.message.text);
      return;
    }
    return next();
  });
}

async function renderResultsPage(
  ctx: Context,
  page: number,
  opts: { edit?: boolean } = {}
): Promise<void> {
  const total = await countInterviews();
  const totalPages = Math.max(1, Math.ceil(total / RESULTS_PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const offset = currentPage * RESULTS_PAGE_SIZE;
  const items = await getRecentInterviews(RESULTS_PAGE_SIZE, offset);

  if (items.length === 0 && total === 0) {
    if (opts.edit) {
      await ctx.editMessageText("Пока нет завершённых интервью.");
    } else {
      await ctx.reply("Пока нет завершённых интервью.");
    }
    return;
  }

  const header = `📋 *Интервью ${offset + 1}–${offset + items.length} из ${total}* \\(стр\\. ${currentPage + 1}/${totalPages}\\)`;
  const lines = [header, ""];
  for (const r of items) {
    const badge = REC_BADGE[r.recommendation] ?? "📋";
    const date = formatDateShort(r.created_at);
    lines.push(
      `${badge} *${escapeMd(r.candidate_name)}* · ${escapeMd(r.vacancy_title)}\n` +
        `   ${r.total_score}/10 · ${escapeMd(r.recommendation)} · _${escapeMd(date)}_`
    );
  }

  const navRow = [];
  if (currentPage > 0) {
    navRow.push(Markup.button.callback("◀ Назад", `results_page:${currentPage - 1}`));
  }
  if (currentPage < totalPages - 1) {
    navRow.push(Markup.button.callback("Вперёд ▶", `results_page:${currentPage + 1}`));
  }

  const text = lines.join("\n\n");
  const keyboard = navRow.length > 0 ? Markup.inlineKeyboard([navRow]) : undefined;

  if (opts.edit) {
    await ctx.editMessageText(text, {
      parse_mode: "MarkdownV2",
      ...(keyboard ?? {}),
    });
  } else {
    await ctx.reply(text, {
      parse_mode: "MarkdownV2",
      ...(keyboard ?? {}),
    });
  }
}

async function handleAddVacancyPayload(ctx: Context, payload: string): Promise<void> {
  const lines = payload
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    await ctx.reply("Нужен заголовок и хотя бы один вопрос. Повторите /add_vacancy.");
    return;
  }
  const [titleLine, ...rest] = lines;
  const [title, description = ""] = titleLine.split("|").map((s) => s.trim());
  if (!title) {
    await ctx.reply("Не удалось разобрать заголовок. Повторите /add_vacancy.");
    return;
  }
  const vacancyId = await addVacancy(title, description);

  let order = 1;
  for (const line of rest) {
    const [qText, criteria = ""] = line
      .replace(/^Q\d+:\s*/i, "")
      .split("|")
      .map((s) => s.trim());
    if (!qText) continue;
    await addQuestion(vacancyId, order, qText, criteria || "Глубина и конкретика ответа.");
    order += 1;
  }

  await ctx.reply(
    `✅ Готово\\. Вакансия *${escapeMd(title)}* \\(\\#${vacancyId}\\) добавлена с *${order - 1}* вопросами\\. ` +
      `Кандидаты увидят её при /start\\.`,
    { parse_mode: "MarkdownV2" }
  );
}
