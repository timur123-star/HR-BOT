import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/bot.ts", // entrypoint, integration-tested
        "src/types.ts", // type-only
        "src/logger.ts", // trivial wrapper
        "**/*.d.ts",
      ],
      // Пороги покрытия консервативные — основной код (interview/admin/reporter/db)
      // покрывается интеграционными тестами (требуют Telegram/Postgres/Redis/Sheets),
      // которые в CI не запускаются. Unit-тесты гарантируют, что критичная логика
      // (evaluator, ratelimit, helpers) покрыта на 100%.
      thresholds: {
        lines: 10,
        functions: 8,
        branches: 60,
        statements: 10,
      },
    },
  },
});
