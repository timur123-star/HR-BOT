import Groq from "groq-sdk";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { AnswerRecord, Evaluation, Recommendation, Summary } from "./types.js";

let client: Groq | null = null;

function getClient(): Groq | null {
  if (!config.groq.enabled) return null;
  if (!client) client = new Groq({ apiKey: config.groq.apiKey });
  return client;
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // try to extract first JSON-looking block
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function callWithRetry<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    logger.warn(`${label} failed, retrying once`, { error: String(err) });
    await new Promise((r) => setTimeout(r, 500));
    return action();
  }
}

export async function evaluateAnswer(
  question: string,
  criteria: string,
  answer: string
): Promise<Evaluation> {
  const groq = getClient();
  if (!groq) {
    logger.warn("Groq disabled — using fallback evaluation");
    return {
      score: 5,
      comment: "AI-оценка отключена (нет GROQ_API_KEY). Ответ сохранён для ручного просмотра.",
    };
  }

  const systemPrompt = `Ты HR-эксперт. Оцени ответ кандидата.
Критерий оценки: ${criteria}
Верни ТОЛЬКО валидный JSON без пояснений: {"score": число от 1 до 10, "comment": "2-3 предложения на русском"}`;

  try {
    const res = await callWithRetry("Groq evaluation", () =>
      groq.chat.completions.create({
        model: config.groq.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Вопрос: ${question}\nОтвет: ${answer}` },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      })
    );

    const content = res.choices[0]?.message?.content ?? "";
    const parsed = extractJson(content) as { score?: unknown; comment?: unknown } | null;
    if (!parsed) {
      logger.warn("Failed to parse Groq evaluation", { content });
      return { score: 5, comment: "Не удалось распарсить ответ AI. Требуется ручная проверка." };
    }
    return {
      score: clampScore(parsed.score),
      comment: typeof parsed.comment === "string" ? parsed.comment : "Без комментария.",
    };
  } catch (err) {
    logger.error("Groq evaluation failed after retry", { error: String(err) });
    return { score: 5, comment: "AI временно недоступен — ответ сохранён, оцените вручную." };
  }
}

function deriveRecommendation(avg: number): Recommendation {
  if (avg >= 8) return "Нанять";
  if (avg >= 5.5) return "Доп.интервью";
  return "Отказать";
}

export async function generateSummary(vacancy: string, answers: AnswerRecord[]): Promise<Summary> {
  const totalScore = answers.length
    ? Math.round((answers.reduce((s, a) => s + a.score, 0) / answers.length) * 10) / 10
    : 0;

  const groq = getClient();
  if (!groq) {
    const text =
      `Сильные стороны: не определены автоматически (AI отключён).\n` +
      `Слабые стороны: не определены автоматически.\n` +
      `Рекомендация: требуется ручная проверка ответов кандидата.`;
    return { summary: text, recommendation: deriveRecommendation(totalScore), totalScore };
  }

  const answersText = answers
    .map(
      (a, i) =>
        `Q${i + 1}: ${a.question}\nОтвет: ${a.text}\nОценка: ${a.score}/10\nКомментарий: ${a.comment}`
    )
    .join("\n\n");

  try {
    const res = await callWithRetry("Groq summary", () =>
      groq.chat.completions.create({
        model: config.groq.model,
        messages: [
          {
            role: "system",
            content: `Ты опытный рекрутер. Составь итоговый анализ кандидата на русском, структурой:
"Сильные стороны: ...
Слабые стороны: ...
Рекомендация: Нанять / Доп.интервью / Отказать (выбери одно)"`,
          },
          { role: "user", content: `Вакансия: ${vacancy}\n\n${answersText}` },
        ],
        temperature: 0.4,
      })
    );

    const summary = res.choices[0]?.message?.content?.trim() ?? "";
    let recommendation = deriveRecommendation(totalScore);
    if (/Нанять/i.test(summary)) recommendation = "Нанять";
    else if (/Доп\.?\s*интервью/i.test(summary)) recommendation = "Доп.интервью";
    else if (/Отказать/i.test(summary)) recommendation = "Отказать";

    return { summary, recommendation, totalScore };
  } catch (err) {
    logger.error("Groq summary failed", { error: String(err) });
    return {
      summary:
        "Не удалось сгенерировать итоговый анализ (AI недоступен). Требуется ручная проверка.",
      recommendation: deriveRecommendation(totalScore),
      totalScore,
    };
  }
}

export const __test__ = { clampScore, extractJson, deriveRecommendation };
