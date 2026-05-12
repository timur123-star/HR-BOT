import { Markup, type Context, type Telegraf } from "telegraf";
import type { Message } from "telegraf/types";
import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  getQuestions,
  getVacancy,
  hasCompletedInterview,
  listActiveVacancies,
  saveInterview,
} from "./db.js";
import { dropSession, loadSession, saveSession } from "./session.js";
import { evaluateAnswer, generateSummary } from "./evaluator.js";
import { escapeMd, progressBar } from "./format.js";
import { appendCandidateRow, generatePdfReport, sendPdfEmail, sheetUrl } from "./reporter.js";
import type { InterviewResult, InterviewSession } from "./types.js";

const ACK_PHRASES = [
  "Принято, спасибо. Следующий вопрос:",
  "Понял, идём дальше.",
  "Отлично, переходим к следующему вопросу:",
  "Записал. Следующий:",
  "Спасибо за ответ. Двигаемся дальше:",
];

const REC_EMOJI: Record<string, string> = {
  Нанять: "🟢",
  "Доп.интервью": "🟡",
  Отказать: "🔴",
};

// progressBar / escapeMd живут в src/format.ts — реэкспортируем
// для обратной совместимости с существующими тестами.
export { progressBar };

function candidateHandle(ctx: Context): string {
  return ctx.from?.username ? `@${ctx.from.username}` : String(ctx.from?.id ?? "unknown");
}

/**
 * Включает индикатор "печатает..." на время выполнения промиса.
 * Telegram сам показывает индикатор ~5 секунд после sendChatAction.
 */
async function withTyping<T>(ctx: Context, action: () => Promise<T>): Promise<T> {
  const chatId = ctx.chat?.id;
  if (!chatId) return action();
  let stopped = false;
  const ping = async (): Promise<void> => {
    while (!stopped) {
      try {
        await ctx.telegram.sendChatAction(chatId, "typing");
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 4500));
    }
  };
  void ping();
  try {
    return await action();
  } finally {
    stopped = true;
  }
}

/**
 * Обработка /start. Учитывает три случая:
 * 1. Deep-link вида /start vac_5 → сразу открывает выбранную вакансию.
 * 2. Незаконченная сессия в Redis → предлагает продолжить или начать заново.
 * 3. Иначе — обычное меню вакансий.
 */
export async function handleStart(ctx: Context): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) return;

  const text = (ctx.message as Message.TextMessage | undefined)?.text ?? "";
  const payload = text.startsWith("/start ") ? text.slice(7).trim() : "";
  const deepLinkMatch = /^vac_(\d+)$/.exec(payload);
  if (deepLinkMatch) {
    await chooseVacancy(ctx, Number(deepLinkMatch[1]));
    return;
  }

  // Если есть незавершённая сессия — предложить продолжить.
  const existing = await loadSession(tgId);
  if (existing && (existing.state === "in_progress" || existing.state === "ready_to_start")) {
    const total = existing.questions.length;
    const current = Math.min(existing.currentStep + 1, total);
    await ctx.reply(
      `У вас есть незавершённое интервью на «${existing.vacancyTitle}» (вопрос ${current} из ${total}). ` +
        "Что делать?",
      Markup.inlineKeyboard([
        [Markup.button.callback("▶️ Продолжить", "resume_interview")],
        [Markup.button.callback("🔄 Начать заново", "restart_interview")],
      ])
    );
    return;
  }

  await sendVacancyMenu(ctx);
}

export async function sendVacancyMenu(ctx: Context): Promise<void> {
  const vacancies = await listActiveVacancies();
  if (vacancies.length === 0) {
    await ctx.reply("Сейчас нет активных вакансий. Загляните позже!");
    return;
  }

  const lines: string[] = [
    "👋 *Привет\\! Я HR\\-бот\\.*",
    "",
    "Выберите позицию, на которую хотите откликнуться:",
  ];
  for (const v of vacancies) {
    lines.push("");
    lines.push(`📌 *${escapeMd(v.title)}*`);
    if (v.description) {
      const shortDesc =
        v.description.length > 110 ? v.description.slice(0, 110).trimEnd() + "…" : v.description;
      lines.push(`_${escapeMd(shortDesc)}_`);
    }
  }
  const buttons = vacancies.map((v) => [Markup.button.callback(v.title, `vacancy:${v.id}`)]);

  await ctx.reply(lines.join("\n"), {
    parse_mode: "MarkdownV2",
    ...Markup.inlineKeyboard(buttons),
  });
}

export async function chooseVacancy(ctx: Context, vacancyId: number): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) return;

  const vacancy = await getVacancy(vacancyId);
  if (!vacancy || !vacancy.is_active) {
    await ctx.reply("Эта вакансия больше неактивна. Попробуйте /start ещё раз.");
    return;
  }

  if (await hasCompletedInterview(candidateHandle(ctx), vacancyId)) {
    await ctx.reply(
      `Вы уже проходили интервью на «${vacancy.title}». Повторное прохождение не предусмотрено — рекрутер свяжется с вами по результатам.`
    );
    return;
  }

  const questions = await getQuestions(vacancyId);
  if (questions.length === 0) {
    await ctx.reply("Для этой вакансии пока нет вопросов. Сообщите рекрутеру.");
    return;
  }

  const session: InterviewSession = {
    vacancyId,
    vacancyTitle: vacancy.title,
    questions,
    currentStep: 0,
    answers: {},
    candidateName: "",
    startedAt: Date.now(),
    state: "awaiting_name",
  };
  await saveSession(tgId, session);

  const intro =
    `✅ *Отличный выбор — «${escapeMd(vacancy.title)}»*\n\n` +
    (vacancy.description ? `${escapeMd(vacancy.description)}\n\n` : "") +
    `Перед началом — как вас зовут? Напишите *имя и фамилию* одним сообщением\\.`;
  await ctx.reply(intro, { parse_mode: "MarkdownV2" });
}

async function startQuestions(ctx: Context, session: InterviewSession): Promise<void> {
  session.state = "in_progress";
  session.currentStep = 0;
  await saveSession(ctx.from!.id, session);
  await sendCurrentQuestion(ctx, session);
}

async function sendCurrentQuestion(ctx: Context, session: InterviewSession): Promise<void> {
  const q = session.questions[session.currentStep];
  const total = session.questions.length;
  const bar = progressBar(session.currentStep, total);
  const text =
    `*Вопрос ${session.currentStep + 1} из ${total}*  \`${bar}\`\n\n` +
    `${escapeMd(q.text)}\n\n` +
    `_Отвечайте развёрнуто, минимум ${config.runtime.minAnswerLength} символов\\._`;
  await ctx.reply(text, { parse_mode: "MarkdownV2" });
}

export async function handleText(ctx: Context, text: string): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) return;
  const session = await loadSession(tgId);
  if (!session) {
    await ctx.reply("Чтобы начать интервью, отправьте /start.");
    return;
  }

  if (session.state === "awaiting_name") {
    const name = text.trim();
    if (name.length < 2) {
      await ctx.reply("Пожалуйста, напишите имя и фамилию (хотя бы 2 символа).");
      return;
    }
    session.candidateName = name;
    session.state = "ready_to_start";
    await saveSession(tgId, session);
    await ctx.reply(
      `Спасибо, *${escapeMd(name)}*\\.\n\n` +
        `Вас ждут *${session.questions.length} вопросов* \\(\\~10 минут\\)\\. ` +
        `Отвечайте развёрнуто — это первичный отбор, оценки скрыты от вас\\. ` +
        `В любой момент можно прервать командой /cancel\\.`,
      {
        parse_mode: "MarkdownV2",
        ...Markup.inlineKeyboard([Markup.button.callback("🚀 Готов начать", "start_questions")]),
      }
    );
    return;
  }

  if (session.state === "ready_to_start") {
    await ctx.reply("Нажмите кнопку «🚀 Готов начать», чтобы перейти к первому вопросу.");
    return;
  }

  if (session.state === "in_progress") {
    const trimmed = text.trim();
    if (trimmed.length < config.runtime.minAnswerLength) {
      await ctx.reply(
        `Сейчас ${trimmed.length} символов — нужно минимум ${config.runtime.minAnswerLength}. ` +
          `Опишите подробнее, для нас это важно.`
      );
      return;
    }
    await processAnswer(ctx, session, trimmed);
    return;
  }

  if (session.state === "completed") {
    await ctx.reply("Интервью уже завершено. Спасибо!");
  }
}

export async function startQuestionsFromCallback(ctx: Context): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) return;
  const session = await loadSession(tgId);
  if (!session || session.state !== "ready_to_start") {
    await ctx.reply("Чтобы начать, отправьте /start.");
    return;
  }
  await startQuestions(ctx, session);
}

export async function cancelInterview(ctx: Context): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) return;
  const session = await loadSession(tgId);
  if (!session) {
    await ctx.reply("Активного интервью нет. Отправьте /start, чтобы выбрать вакансию.");
    return;
  }
  await dropSession(tgId);
  await ctx.reply("Интервью прервано. Вы можете начать заново в любой момент командой /start.");
}

async function processAnswer(
  ctx: Context,
  session: InterviewSession,
  answer: string
): Promise<void> {
  const tgId = ctx.from!.id;
  const q = session.questions[session.currentStep];

  const evaluation = await withTyping(ctx, () => evaluateAnswer(q.text, q.criteria, answer));
  session.answers[q.id] = {
    question_id: q.id,
    question: q.text,
    text: answer,
    score: evaluation.score,
    comment: evaluation.comment,
  };
  session.currentStep += 1;

  if (session.currentStep >= session.questions.length) {
    session.state = "completed";
    await saveSession(tgId, session);
    await finishInterview(ctx, session);
  } else {
    await saveSession(tgId, session);
    const phrase = ACK_PHRASES[(session.currentStep - 1) % ACK_PHRASES.length];
    await ctx.reply(phrase);
    await sendCurrentQuestion(ctx, session);
  }
}

export async function finishInterview(ctx: Context, session: InterviewSession): Promise<void> {
  const tgId = ctx.from!.id;
  const handle = candidateHandle(ctx);
  const answers = session.questions.map(
    (q) =>
      session.answers[q.id] ?? {
        question_id: q.id,
        question: q.text,
        text: "(нет ответа)",
        score: 1,
        comment: "Ответ не получен.",
      }
  );

  const summary = await withTyping(ctx, () => generateSummary(session.vacancyTitle, answers));

  const interviewId = await saveInterview({
    candidateName: session.candidateName || handle,
    candidateTg: handle,
    vacancyId: session.vacancyId,
    answers,
    totalScore: Math.round(summary.totalScore),
    aiSummary: summary.summary,
    recommendation: summary.recommendation,
    status: "completed",
  });

  await ctx.reply(
    `🎉 *Интервью завершено\\!* Спасибо, ${escapeMd(session.candidateName || "кандидат")}\\.\n\n` +
      `Рекрутер изучит ваши ответы и свяжется с вами в течение *24 часов*\\.\n\n` +
      `Если хотите попробовать другую позицию — нажмите кнопку ниже\\.`,
    {
      parse_mode: "MarkdownV2",
      ...Markup.inlineKeyboard([Markup.button.callback("🔁 Другая вакансия", "another_vacancy")]),
    }
  );

  const result: InterviewResult = {
    id: interviewId,
    candidate_name: session.candidateName || handle,
    candidate_tg: handle,
    vacancy_id: session.vacancyId,
    vacancy_title: session.vacancyTitle,
    answers,
    total_score: Math.round(summary.totalScore),
    ai_summary: summary.summary,
    recommendation: summary.recommendation,
    status: "completed",
    created_at: new Date(),
  };

  // Параллельные пайплайны: Sheets критичен, PDF + email + admin best-effort.
  const pdfPromise = generatePdfReport(result).catch((err) => {
    logger.error("PDF generation failed", { error: String(err) });
    return null;
  });

  const results = await Promise.allSettled([
    appendCandidateRow(result),
    (async () => {
      const pdf = await pdfPromise;
      if (pdf) await sendPdfEmail(result, pdf);
    })(),
    (async () => {
      const pdf = await pdfPromise;
      await notifyAdmin(ctx, result, pdf);
    })(),
  ]);
  for (const r of results) {
    if (r.status === "rejected")
      logger.error("post-interview task failed", { reason: String(r.reason) });
  }

  await dropSession(tgId);
}

async function notifyAdmin(
  ctx: Context,
  result: InterviewResult,
  pdfPath: string | null
): Promise<void> {
  if (!config.telegram.adminUserId) return;
  try {
    const emoji = REC_EMOJI[result.recommendation] ?? "📋";
    const link = sheetUrl();
    const summaryPreview =
      result.ai_summary.length > 700 ? result.ai_summary.slice(0, 700) + "…" : result.ai_summary;
    const message =
      `${emoji} *Новое интервью*\n\n` +
      `👤 *Кандидат:* ${escapeMd(result.candidate_name)} \\(${escapeMd(result.candidate_tg)}\\)\n` +
      `💼 *Вакансия:* ${escapeMd(result.vacancy_title)}\n` +
      `⭐ *Балл:* ${result.total_score}/10\n` +
      `📌 *Рекомендация:* ${escapeMd(result.recommendation)}\n\n` +
      `${escapeMd(summaryPreview)}`;

    const buttons = [];
    if (link) buttons.push([Markup.button.url("📊 Открыть таблицу", link)]);

    await ctx.telegram.sendMessage(config.telegram.adminUserId, message, {
      parse_mode: "MarkdownV2",
      ...(buttons.length ? Markup.inlineKeyboard(buttons) : {}),
    });

    if (pdfPath) {
      await ctx.telegram.sendDocument(config.telegram.adminUserId, {
        source: pdfPath,
        filename: `interview_${result.id}_${result.candidate_name.replace(/\s+/g, "_")}.pdf`,
      });
    }
  } catch (err) {
    logger.error("Failed to notify admin", { error: String(err) });
  }
}

export function registerInterviewHandlers(bot: Telegraf): void {
  bot.action(/^vacancy:(\d+)$/, async (ctx) => {
    const match = ctx.match[1];
    await ctx.answerCbQuery();
    await chooseVacancy(ctx, Number(match));
  });
  bot.action("start_questions", async (ctx) => {
    await ctx.answerCbQuery();
    await startQuestionsFromCallback(ctx);
  });
  bot.action("another_vacancy", async (ctx) => {
    await ctx.answerCbQuery();
    await sendVacancyMenu(ctx);
  });
  bot.action("resume_interview", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const session = await loadSession(tgId);
    if (!session) {
      await sendVacancyMenu(ctx);
      return;
    }
    if (session.state === "ready_to_start") {
      await startQuestions(ctx, session);
    } else if (session.state === "in_progress") {
      await sendCurrentQuestion(ctx, session);
    } else {
      await sendVacancyMenu(ctx);
    }
  });
  bot.action("restart_interview", async (ctx) => {
    await ctx.answerCbQuery();
    const tgId = ctx.from?.id;
    if (tgId) await dropSession(tgId);
    await sendVacancyMenu(ctx);
  });
}
