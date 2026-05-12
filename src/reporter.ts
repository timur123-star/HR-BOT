import { google, sheets_v4 } from "googleapis";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { InterviewResult, Recommendation } from "./types.js";

// ---------- Google Sheets ----------

const CANDIDATES_SHEET = "Кандидаты";
const STATS_SHEET = "Статистика";
const HEADER_ROW = [
  "Дата",
  "Имя",
  "Telegram",
  "Вакансия",
  "Балл",
  "Рекомендация",
  "AI-резюме",
  "Контакт",
] as const;

// Цвета бренда (RGB 0-1 как требует Sheets API)
const COLOR_HEADER_BG = { red: 0.2, green: 0.27, blue: 0.42 }; // глубокий синий
const COLOR_HEADER_FG = { red: 1, green: 1, blue: 1 };
const COLOR_BAND_ALT = { red: 0.96, green: 0.97, blue: 1 };
const COLOR_HIRE = { red: 0.85, green: 0.95, blue: 0.85 };
const COLOR_MAYBE = { red: 1, green: 0.96, blue: 0.78 };
const COLOR_REJECT = { red: 0.99, green: 0.86, blue: 0.86 };
const COLOR_SECTION = { red: 0.93, green: 0.93, blue: 0.97 };

function getSheetsClient(): sheets_v4.Sheets | null {
  if (!config.sheets.enabled) return null;
  const auth = new google.auth.GoogleAuth({
    credentials: config.sheets.credentials as Record<string, unknown>,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

interface SheetMeta {
  sheetId: number;
  title: string;
  index: number;
}

async function listSheets(sheets: sheets_v4.Sheets): Promise<SheetMeta[]> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheets.sheetId });
  return (meta.data.sheets ?? [])
    .filter((s) => s.properties?.sheetId !== undefined && s.properties.title !== undefined)
    .map((s) => ({
      sheetId: s.properties!.sheetId!,
      title: s.properties!.title!,
      index: s.properties!.index ?? 0,
    }));
}

/**
 * Создаёт листы "Кандидаты" и "Статистика" с заголовками, форматированием
 * и условным форматированием по рекомендации. Идемпотентна.
 *
 * Главная задача — чтобы рекрутер открыл таблицу и сразу увидел работающий
 * дашборд: "Кандидаты" первой вкладкой, цветной заголовок, замороженная
 * строка, цветные строки по рекомендации.
 */
export async function ensureSheetsLayout(): Promise<void> {
  const sheets = getSheetsClient();
  if (!sheets) return;

  try {
    // 1. Создать недостающие листы.
    let existingSheets = await listSheets(sheets);
    const titles = new Set(existingSheets.map((s) => s.title));

    const addRequests: sheets_v4.Schema$Request[] = [];
    if (!titles.has(CANDIDATES_SHEET)) {
      addRequests.push({ addSheet: { properties: { title: CANDIDATES_SHEET, index: 0 } } });
    }
    if (!titles.has(STATS_SHEET)) {
      addRequests.push({ addSheet: { properties: { title: STATS_SHEET, index: 1 } } });
    }
    if (addRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.sheets.sheetId,
        requestBody: { requests: addRequests },
      });
      existingSheets = await listSheets(sheets);
    }

    const candidates = existingSheets.find((s) => s.title === CANDIDATES_SHEET);
    const stats = existingSheets.find((s) => s.title === STATS_SHEET);
    if (!candidates || !stats) {
      throw new Error("Не удалось создать листы Кандидаты/Статистика");
    }

    // 2. Переместить "Кандидаты" на позицию 0. Дефолтный "Лист1" удалить если пуст.
    const moveRequests: sheets_v4.Schema$Request[] = [];
    if (candidates.index !== 0) {
      moveRequests.push({
        updateSheetProperties: {
          properties: { sheetId: candidates.sheetId, index: 0 },
          fields: "index",
        },
      });
    }
    const defaultSheet = existingSheets.find(
      (s) =>
        ["Лист1", "Sheet1"].includes(s.title) &&
        s.sheetId !== candidates.sheetId &&
        s.sheetId !== stats.sheetId
    );
    if (defaultSheet) {
      // Безопасно удалить только если пуст — иначе сдвинуть в конец.
      try {
        const valuesRes = await sheets.spreadsheets.values.get({
          spreadsheetId: config.sheets.sheetId,
          range: `${defaultSheet.title}!A1:Z1000`,
        });
        const hasData = (valuesRes.data.values ?? []).some((row) =>
          row.some((cell) => cell !== "")
        );
        if (!hasData) {
          moveRequests.push({ deleteSheet: { sheetId: defaultSheet.sheetId } });
        }
      } catch {
        // ignore
      }
    }
    if (moveRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.sheets.sheetId,
        requestBody: { requests: moveRequests },
      });
    }

    // 3. Записать заголовок "Кандидаты".
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.sheetId,
      range: `${CANDIDATES_SHEET}!A1:H1`,
      valueInputOption: "RAW",
      requestBody: { values: [Array.from(HEADER_ROW)] },
    });

    // 4. Применить форматирование "Кандидаты":
    //    жирный заголовок + цвет, заморозка, ширина колонок, wrap text,
    //    бандинг и условное форматирование по колонке "Рекомендация".
    const formattingRequests: sheets_v4.Schema$Request[] = [
      // Заголовок: цвет фона + белый жирный текст + центр.
      {
        repeatCell: {
          range: {
            sheetId: candidates.sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 8,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: COLOR_HEADER_BG,
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
              textFormat: { foregroundColor: COLOR_HEADER_FG, bold: true, fontSize: 11 },
            },
          },
          fields:
            "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
        },
      },
      // Заморозить первую строку.
      {
        updateSheetProperties: {
          properties: { sheetId: candidates.sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      // Ширина колонок.
      ...[
        { col: 0, w: 130 }, // Дата
        { col: 1, w: 160 }, // Имя
        { col: 2, w: 140 }, // Telegram
        { col: 3, w: 180 }, // Вакансия
        { col: 4, w: 60 }, // Балл
        { col: 5, w: 120 }, // Рекомендация
        { col: 6, w: 420 }, // AI-резюме
        { col: 7, w: 200 }, // Контакт
      ].map(
        ({ col, w }): sheets_v4.Schema$Request => ({
          updateDimensionProperties: {
            range: {
              sheetId: candidates.sheetId,
              dimension: "COLUMNS",
              startIndex: col,
              endIndex: col + 1,
            },
            properties: { pixelSize: w },
            fields: "pixelSize",
          },
        })
      ),
      // Wrap-text для AI-резюме (колонка G = индекс 6).
      {
        repeatCell: {
          range: {
            sheetId: candidates.sheetId,
            startRowIndex: 1,
            startColumnIndex: 6,
            endColumnIndex: 7,
          },
          cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
          fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
        },
      },
      // Зебра-фон для тела таблицы.
      {
        addBanding: {
          bandedRange: {
            range: {
              sheetId: candidates.sheetId,
              startRowIndex: 0,
              startColumnIndex: 0,
              endColumnIndex: 8,
            },
            rowProperties: {
              headerColor: COLOR_HEADER_BG,
              firstBandColor: { red: 1, green: 1, blue: 1 },
              secondBandColor: COLOR_BAND_ALT,
            },
          },
        },
      },
      // Условное форматирование по колонке "Рекомендация" (F = индекс 5).
      ...buildConditionalFormatting(candidates.sheetId),
    ];

    // Бандинг и conditional rules могут быть уже добавлены при предыдущем запуске —
    // ловим коды 400 и игнорим, чтобы не падать.
    await safeBatch(sheets, formattingRequests);

    // 5. Лист "Статистика" — оформленный дашборд с формулами.
    await renderStatsSheet(sheets, stats.sheetId);

    logger.info("Google Sheets layout ensured");
  } catch (err) {
    logger.error("ensureSheetsLayout failed", { error: String(err) });
  }
}

function buildConditionalFormatting(sheetId: number): sheets_v4.Schema$Request[] {
  const baseRange: sheets_v4.Schema$GridRange = {
    sheetId,
    startRowIndex: 1,
    startColumnIndex: 5,
    endColumnIndex: 6,
  };
  return [
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [baseRange],
          booleanRule: {
            condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "Нанять" }] },
            format: { backgroundColor: COLOR_HIRE, textFormat: { bold: true } },
          },
        },
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [baseRange],
          booleanRule: {
            condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "Доп.интервью" }] },
            format: { backgroundColor: COLOR_MAYBE },
          },
        },
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [baseRange],
          booleanRule: {
            condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "Отказать" }] },
            format: { backgroundColor: COLOR_REJECT },
          },
        },
      },
    },
  ];
}

/**
 * Отправляет батч и для запросов, которые могут быть дубликатами (бандинг,
 * условное форматирование), пробует каждый по одному, если падает целиком.
 */
async function safeBatch(
  sheets: sheets_v4.Sheets,
  requests: sheets_v4.Schema$Request[]
): Promise<void> {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheets.sheetId,
      requestBody: { requests },
    });
    return;
  } catch (err) {
    logger.debug("Batch update failed wholesale, retrying per-request", { error: String(err) });
  }
  for (const req of requests) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.sheets.sheetId,
        requestBody: { requests: [req] },
      });
    } catch (err) {
      logger.debug("Individual format request failed (likely already applied)", {
        error: String(err),
      });
    }
  }
}

async function renderStatsSheet(sheets: sheets_v4.Sheets, sheetId: number): Promise<void> {
  // Сначала записываем формулы как USER_ENTERED.
  const values: string[][] = [
    ["📊 СВОДКА ПО ВОРОНКЕ", ""],
    ["Всего интервью", `=COUNTA('${CANDIDATES_SHEET}'!B2:B)`],
    [
      "Средний балл",
      `=IFERROR(ROUND(AVERAGE(ARRAYFORMULA(IFERROR(VALUE(REGEXEXTRACT('${CANDIDATES_SHEET}'!E2:E,"^\\d+"))))),1),0)`,
    ],
    ["Прошли сегодня", `=COUNTIF('${CANDIDATES_SHEET}'!A2:A,">="&TEXT(TODAY(),"dd.mm.yyyy"))`],
    ["Прошли за 7 дней", `=COUNTA('${CANDIDATES_SHEET}'!A2:A)`],
    ["", ""],
    ["🏆 ТОП-5 КАНДИДАТОВ", ""],
    ["Имя", "Балл"],
    [
      `=IFERROR(QUERY('${CANDIDATES_SHEET}'!A:H,"select B, E where E is not null order by E desc limit 5",0),"Нет данных")`,
      "",
    ],
    ["", ""],
    ["📈 ПО ВАКАНСИЯМ", ""],
    ["Вакансия", "Кол-во"],
    [
      `=IFERROR(QUERY('${CANDIDATES_SHEET}'!D2:D,"select D, count(D) where D is not null group by D order by count(D) desc",0),"Нет данных")`,
      "",
    ],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheets.sheetId,
    range: `${STATS_SHEET}!A1:B${values.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  // Форматирование секций.
  const formatRequests: sheets_v4.Schema$Request[] = [
    // Заголовок секции "Сводка"
    sectionHeader(sheetId, 0),
    // "Топ-5"
    sectionHeader(sheetId, 6),
    // "По вакансиям"
    sectionHeader(sheetId, 10),
    // Полужирные подзаголовки колонок (строки 7=ТОП, 11=ПО ВАКАНСИЯМ)
    boldRow(sheetId, 7),
    boldRow(sheetId, 11),
    // Ширина
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 240 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 140 },
        fields: "pixelSize",
      },
    },
  ];
  await safeBatch(sheets, formatRequests);
}

function sectionHeader(sheetId: number, rowIndex: number): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rowIndex,
        endRowIndex: rowIndex + 1,
        startColumnIndex: 0,
        endColumnIndex: 2,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLOR_HEADER_BG,
          textFormat: { foregroundColor: COLOR_HEADER_FG, bold: true, fontSize: 12 },
          horizontalAlignment: "LEFT",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  };
}

function boldRow(sheetId: number, rowIndex: number): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rowIndex,
        endRowIndex: rowIndex + 1,
        startColumnIndex: 0,
        endColumnIndex: 2,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLOR_SECTION,
          textFormat: { bold: true },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  };
}

function tgHandleToUrl(handle: string): string {
  return handle.startsWith("@")
    ? `https://t.me/${handle.slice(1)}`
    : handle.match(/^\d+$/)
      ? `tg://user?id=${handle}`
      : `https://t.me/${handle}`;
}

/**
 * Добавляет строку с кандидатом в Google Sheets. Главная фича бота.
 */
export async function appendCandidateRow(result: InterviewResult): Promise<void> {
  const sheets = getSheetsClient();
  if (!sheets) {
    logger.warn("Google Sheets disabled — skipping appendCandidateRow", {
      candidate: result.candidate_name,
    });
    return;
  }

  const tgUrl = tgHandleToUrl(result.candidate_tg);
  const row = [
    new Date(result.created_at).toLocaleString("ru-RU"),
    result.candidate_name,
    result.candidate_tg,
    result.vacancy_title,
    `${result.total_score}/10`,
    result.recommendation,
    result.ai_summary.slice(0, 5000),
    `=HYPERLINK("${tgUrl}","Открыть чат →")`,
  ];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheets.sheetId,
      range: `${CANDIDATES_SHEET}!A:H`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
    logger.info("Candidate row appended to Google Sheets", {
      candidate: result.candidate_name,
      vacancy: result.vacancy_title,
    });
  } catch (err) {
    logger.error("appendCandidateRow failed", { error: String(err) });
  }
}

export function sheetUrl(): string | null {
  if (!config.sheets.sheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${config.sheets.sheetId}`;
}

// ---------- PDF ----------

const RECOMMENDATION_COLOR: Record<Recommendation, string> = {
  Нанять: "#2E7D32",
  "Доп.интервью": "#F9A825",
  Отказать: "#C62828",
};

function resolveAsset(name: string): string | null {
  const candidates = [path.resolve("assets", name), path.resolve(process.cwd(), "assets", name)];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Генерирует профессиональный PDF-отчёт с кириллицей. Сохраняет в reports/
 * и возвращает путь.
 */
export async function generatePdfReport(result: InterviewResult): Promise<string> {
  const dir = path.resolve("reports");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `interview_${result.id}_${result.candidate_tg.replace(/[^a-zA-Z0-9_]/g, "_")}.pdf`
  );

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
    const stream = fs.createWriteStream(file);
    doc.pipe(stream);

    // Регистрируем кириллический шрифт (Roboto) — без него pdfkit рендерит
    // кириллицу пустыми квадратами.
    const regular = resolveAsset("Roboto-Regular.ttf");
    const bold = resolveAsset("Roboto-Bold.ttf");
    if (regular) doc.registerFont("Body", regular);
    if (bold) doc.registerFont("BodyBold", bold);
    const bodyFont = regular ? "Body" : "Helvetica";
    const boldFont = bold ? "BodyBold" : "Helvetica-Bold";

    const pageWidth = doc.page.width;
    const marginX = doc.page.margins.left;
    const contentWidth = pageWidth - marginX * 2;

    // --- Header bar ---
    const headerH = 64;
    doc.save();
    doc.rect(0, 0, pageWidth, headerH).fill("#34446B");
    doc.fillColor("#FFFFFF").font(boldFont).fontSize(22).text("HR-BOT", marginX, 18);
    doc
      .font(bodyFont)
      .fontSize(11)
      .fillColor("#CCD3E8")
      .text(`Отчёт по интервью № ${result.id}`, marginX, 44);
    doc
      .font(bodyFont)
      .fontSize(10)
      .fillColor("#CCD3E8")
      .text(new Date(result.created_at).toLocaleString("ru-RU"), marginX, 44, {
        width: contentWidth,
        align: "right",
      });
    doc.restore();

    doc.y = headerH + 18;

    // --- Карточка кандидата ---
    const cardY = doc.y;
    doc.save();
    doc.roundedRect(marginX, cardY, contentWidth, 96, 6).fill("#F4F6FB");
    doc.restore();

    doc
      .font(boldFont)
      .fontSize(16)
      .fillColor("#1A1F36")
      .text(result.candidate_name, marginX + 16, cardY + 14, { width: contentWidth - 200 });
    doc
      .font(bodyFont)
      .fontSize(11)
      .fillColor("#566380")
      .text(`Вакансия: ${result.vacancy_title}`, marginX + 16, cardY + 40);
    doc.text(`Telegram: ${result.candidate_tg}`, marginX + 16, cardY + 56);
    doc.text(
      `Состояние: ${result.status === "completed" ? "Завершено" : "Не завершено"}`,
      marginX + 16,
      cardY + 72
    );

    // Бэйдж рекомендации справа
    const badgeW = 170;
    const badgeX = marginX + contentWidth - badgeW - 12;
    const badgeY = cardY + 16;
    doc.save();
    doc
      .roundedRect(badgeX, badgeY, badgeW, 64, 6)
      .fill(RECOMMENDATION_COLOR[result.recommendation]);
    doc
      .fillColor("#FFFFFF")
      .font(bodyFont)
      .fontSize(10)
      .text("ИТОГОВАЯ РЕКОМЕНДАЦИЯ", badgeX, badgeY + 8, { width: badgeW, align: "center" });
    doc
      .font(boldFont)
      .fontSize(18)
      .text(result.recommendation, badgeX, badgeY + 22, {
        width: badgeW,
        align: "center",
      });
    doc
      .font(bodyFont)
      .fontSize(12)
      .text(`${result.total_score}/10`, badgeX, badgeY + 46, { width: badgeW, align: "center" });
    doc.restore();

    doc.y = cardY + 96 + 18;

    // --- Вопросы ---
    doc.font(boldFont).fontSize(14).fillColor("#1A1F36").text("Вопросы и ответы");
    doc.moveDown(0.4);
    doc
      .strokeColor("#E1E5EE")
      .lineWidth(1)
      .moveTo(marginX, doc.y)
      .lineTo(marginX + contentWidth, doc.y)
      .stroke();
    doc.moveDown(0.6);

    result.answers.forEach((a, i) => {
      // Маленькая «зебра» для каждого блока вопроса
      const blockStart = doc.y;
      doc
        .font(boldFont)
        .fontSize(11)
        .fillColor("#1A1F36")
        .text(`Вопрос ${i + 1}.`, { continued: false });
      doc.font(bodyFont).fontSize(11).fillColor("#1A1F36").text(a.question, { indent: 0 });
      doc.moveDown(0.2);

      doc.font(bodyFont).fontSize(10).fillColor("#566380").text("Ответ:", { continued: true });
      doc.fillColor("#1A1F36").text(` ${a.text}`, { indent: 0 });
      doc.moveDown(0.2);

      const scoreColor = a.score >= 8 ? "#2E7D32" : a.score >= 5 ? "#F9A825" : "#C62828";
      doc.font(bodyFont).fontSize(10).fillColor("#566380").text("Оценка:", { continued: true });
      doc.fillColor(scoreColor).font(boldFont).text(` ${a.score}/10`, { continued: true });
      doc.font(bodyFont).fillColor("#1A1F36").text(` — ${a.comment}`);

      doc.moveDown(0.8);

      // Тонкая линия между вопросами
      if (i < result.answers.length - 1) {
        doc
          .strokeColor("#EEF1F7")
          .lineWidth(0.5)
          .moveTo(marginX, doc.y)
          .lineTo(marginX + contentWidth, doc.y)
          .stroke();
        doc.moveDown(0.4);
      }
      void blockStart;
    });

    // --- AI-резюме ---
    doc.moveDown(0.4);
    doc.font(boldFont).fontSize(14).fillColor("#1A1F36").text("Итоговый AI-анализ");
    doc.moveDown(0.2);
    doc
      .strokeColor("#E1E5EE")
      .lineWidth(1)
      .moveTo(marginX, doc.y)
      .lineTo(marginX + contentWidth, doc.y)
      .stroke();
    doc.moveDown(0.4);
    doc.font(bodyFont).fontSize(11).fillColor("#1A1F36").text(result.ai_summary, { align: "left" });

    // Футер.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc
        .font(bodyFont)
        .fontSize(8)
        .fillColor("#8892B0")
        .text(
          `HR-BOT · Интервью #${result.id} · стр. ${i - range.start + 1}/${range.count}`,
          marginX,
          doc.page.height - 36,
          { width: contentWidth, align: "center" }
        );
    }

    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", (err) => reject(err));
  });

  return file;
}

// ---------- Email ----------

let mailer: nodemailer.Transporter | null = null;
function getMailer(): nodemailer.Transporter | null {
  if (!config.email.enabled) return null;
  if (mailer) return mailer;
  mailer = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465,
    auth: config.email.user ? { user: config.email.user, pass: config.email.pass } : undefined,
  });
  return mailer;
}

export async function sendPdfEmail(result: InterviewResult, pdfPath: string): Promise<void> {
  const m = getMailer();
  if (!m) {
    logger.warn("Email disabled — skipping sendPdfEmail");
    return;
  }
  try {
    await m.sendMail({
      from: config.email.from,
      to: config.email.recruiter,
      subject: `Новое интервью: ${result.candidate_name} — ${result.vacancy_title}`,
      text:
        `Кандидат: ${result.candidate_name}\n` +
        `Telegram: ${result.candidate_tg}\n` +
        `Вакансия: ${result.vacancy_title}\n` +
        `Балл: ${result.total_score}/10\n` +
        `Рекомендация: ${result.recommendation}\n\n` +
        result.ai_summary,
      attachments: [{ filename: path.basename(pdfPath), path: pdfPath }],
    });
    logger.info("Email sent to recruiter", { to: config.email.recruiter });
  } catch (err) {
    logger.error("sendPdfEmail failed", { error: String(err) });
  }
}
