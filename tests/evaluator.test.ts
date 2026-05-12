import { describe, expect, it } from "vitest";
import { __test__ } from "../src/evaluator.js";

const { clampScore, extractJson, deriveRecommendation } = __test__;

describe("clampScore", () => {
  it("clamps below 1 to 1", () => {
    expect(clampScore(-3)).toBe(1);
    expect(clampScore(0)).toBe(1);
  });
  it("clamps above 10 to 10", () => {
    expect(clampScore(12)).toBe(10);
    expect(clampScore(100)).toBe(10);
  });
  it("rounds and keeps in range", () => {
    expect(clampScore(7.4)).toBe(7);
    expect(clampScore(7.6)).toBe(8);
  });
  it("returns 5 for non-numeric", () => {
    expect(clampScore("foo")).toBe(5);
    expect(clampScore(undefined)).toBe(5);
  });
});

describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"score": 8, "comment": "good"}')).toEqual({
      score: 8,
      comment: "good",
    });
  });
  it("extracts JSON from prose", () => {
    expect(extractJson('here is my answer: {"score": 6, "comment": "ok"} thanks!')).toEqual({
      score: 6,
      comment: "ok",
    });
  });
  it("returns null on garbage", () => {
    expect(extractJson("not json at all")).toBeNull();
  });
});

describe("deriveRecommendation", () => {
  it("Нанять for >= 8", () => {
    expect(deriveRecommendation(8)).toBe("Нанять");
    expect(deriveRecommendation(9.5)).toBe("Нанять");
  });
  it("Доп.интервью for 5.5..7.9", () => {
    expect(deriveRecommendation(5.5)).toBe("Доп.интервью");
    expect(deriveRecommendation(7)).toBe("Доп.интервью");
  });
  it("Отказать for <5.5", () => {
    expect(deriveRecommendation(5.4)).toBe("Отказать");
    expect(deriveRecommendation(0)).toBe("Отказать");
  });
});
