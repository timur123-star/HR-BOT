// Гарантируем валидную ENV для модуля config во время unit-тестов.
process.env.TELEGRAM_BOT_TOKEN ??= "1234567890:TEST_TOKEN_FOR_VITEST";
process.env.GROQ_API_KEY ??= "";
process.env.DATABASE_URL ??= "postgres://hrbot:hrbot@localhost:5432/hrbot";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.LOG_LEVEL ??= "error";
