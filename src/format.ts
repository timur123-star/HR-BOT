/**
 * Маленькие чистые форматтеры, общие для всех модулей.
 *
 * Здесь живут хелперы, которые раньше дублировались в interview.ts и admin.ts:
 * MarkdownV2-экранирование, прогресс-бар интервью, текстовый бар для /stats,
 * читаемая дата и редакция PII для логов. Никаких зависимостей, чтобы файл
 * был тривиально юнит-тестируемым.
 */

const PROGRESS_FILLED = "▓";
const PROGRESS_EMPTY = "░";

/**
 * Экранирует строку для Telegram MarkdownV2.
 *
 * Telegram требует экранировать `_*[]()~`>#+-=|{}.!` в обычном тексте — иначе
 * сообщение не отправится. Используется всюду, где мы подставляем имя
 * кандидата, название вакансии или произвольный текст внутри MarkdownV2.
 */
export function escapeMd(text: string): string {
  return text.replace(/([_*[\]()~`>#+=|{}.!\\-])/g, "\\$1");
}

/**
 * Прогресс-бар для интервью: `▓▓░░░` для 2 из 5.
 *
 * Используется в шапке каждого вопроса. Кандидат сразу видит, сколько
 * вопросов осталось.
 */
export function progressBar(current: number, total: number): string {
  if (total <= 0) return "";
  const filled = Math.max(0, Math.min(total, current));
  return PROGRESS_FILLED.repeat(filled) + PROGRESS_EMPTY.repeat(total - filled);
}

/**
 * Текстовый бар фиксированной ширины: `██████░░░░` для value/max.
 *
 * Используется в /stats — рекрутер глазом видит долю «сегодня» от
 * максимума без графиков и без зависимостей.
 */
export function textBar(value: number, max: number, width = 10): string {
  if (max <= 0) return "─".repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * Дата в локальном формате `ДД.ММ.ГГ ЧЧ:ММ` — для /results и колонки
 * «Дата» в Google Sheets. Не зависит от системной локали.
 */
export function formatDateShort(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Полная дата `ДД.ММ.ГГГГ ЧЧ:ММ:СС` — для отчёта в PDF и аудита.
 */
export function formatDateFull(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString("ru-RU");
}

/**
 * Редакция PII для логов. По умолчанию маскируем имена кандидатов и контакты:
 * `Иван Петров` → `И*** П***`, `@somehandle` → `@s***`, `+71234567890` → `+7***`.
 *
 * Используется в logger meta, чтобы в продакшен-логах (Railway, Sentry)
 * не светилось полное PII кандидатов.
 */
export function redactPii(value: string): string {
  if (!value) return value;
  // Маскируем телефон в международном формате.
  if (/^\+?\d{6,}$/.test(value.replace(/\s+/g, ""))) {
    return value.slice(0, 2) + "***";
  }
  // Маскируем Telegram-handle.
  if (value.startsWith("@") && value.length > 2) {
    return `${value.slice(0, 2)}***`;
  }
  // Маскируем имя по словам: первая буква + ***.
  return value
    .split(/\s+/)
    .map((word) => (word.length <= 1 ? word : `${word[0]}***`))
    .join(" ");
}
