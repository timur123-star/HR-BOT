import { describe, expect, it } from "vitest";
import {
  escapeMd,
  formatDateFull,
  formatDateShort,
  progressBar,
  redactPii,
  textBar,
} from "../src/format.js";

describe("escapeMd", () => {
  it("escapes all MarkdownV2 special chars", () => {
    expect(escapeMd("hello.world!")).toBe("hello\\.world\\!");
    expect(escapeMd("a_b*c[d]e")).toBe("a\\_b\\*c\\[d\\]e");
    expect(escapeMd("(x)~y`z>q")).toBe("\\(x\\)\\~y\\`z\\>q");
    expect(escapeMd("a-b")).toBe("a\\-b");
  });

  it("returns plain text unchanged", () => {
    expect(escapeMd("Тимур Валерьевич")).toBe("Тимур Валерьевич");
    expect(escapeMd("")).toBe("");
  });
});

describe("progressBar", () => {
  it("renders filled/empty correctly", () => {
    expect(progressBar(0, 5)).toBe("░░░░░");
    expect(progressBar(2, 5)).toBe("▓▓░░░");
    expect(progressBar(5, 5)).toBe("▓▓▓▓▓");
  });

  it("clamps out-of-range values", () => {
    expect(progressBar(-1, 5)).toBe("░░░░░");
    expect(progressBar(10, 5)).toBe("▓▓▓▓▓");
  });

  it("returns empty string for non-positive totals", () => {
    expect(progressBar(0, 0)).toBe("");
    expect(progressBar(1, -3)).toBe("");
  });
});

describe("textBar", () => {
  it("renders a 10-wide bar by default", () => {
    expect(textBar(5, 10)).toBe("█████░░░░░");
    expect(textBar(10, 10)).toBe("██████████");
    expect(textBar(0, 10)).toBe("░░░░░░░░░░");
  });

  it("honours custom width", () => {
    expect(textBar(2, 4, 4)).toBe("██░░");
  });

  it("returns a placeholder for empty max", () => {
    expect(textBar(0, 0)).toBe("──────────");
  });
});

describe("formatDateShort / formatDateFull", () => {
  it("formats Date and ISO strings", () => {
    const d = new Date("2026-05-12T08:30:00Z");
    expect(formatDateShort(d)).toMatch(/\d{2}\.\d{2}\.\d{2}/);
    expect(formatDateFull("2026-05-12T08:30:00Z")).toMatch(/2026/);
  });
});

describe("redactPii", () => {
  it("masks names by first letter per word", () => {
    expect(redactPii("Иван Петров")).toBe("И*** П***");
    expect(redactPii("Анна")).toBe("А***");
  });

  it("masks Telegram handles", () => {
    expect(redactPii("@somehandle")).toBe("@s***");
  });

  it("masks phone numbers", () => {
    expect(redactPii("+71234567890")).toBe("+7***");
    expect(redactPii("89001234567")).toBe("89***");
  });

  it("returns empty input unchanged", () => {
    expect(redactPii("")).toBe("");
  });
});
