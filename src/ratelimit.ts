import { getRedis } from "./session.js";
import { logger } from "./logger.js";

/**
 * Простой токен-бакет на Redis: разрешено `max` действий за окно `windowSec`.
 * Возвращает true если можно действовать, false если лимит превышен.
 */
export async function checkRate(
  tgId: number,
  action: string,
  max: number,
  windowSec: number
): Promise<boolean> {
  try {
    const r = await getRedis();
    const key = `rate:${action}:${tgId}`;
    const val = await r.incr(key);
    if (val === 1) await r.expire(key, windowSec);
    return val <= max;
  } catch (err) {
    // Если Redis недоступен — не блокируем, лучше пропустить чем заDOSить себя сами.
    logger.warn("Rate-limit check failed, allowing", { tgId, action, error: String(err) });
    return true;
  }
}
