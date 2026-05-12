import { describe, expect, it } from "vitest";
import { progressBar } from "../src/interview.js";

describe("progressBar", () => {
  it("renders empty bar at start", () => {
    expect(progressBar(0, 5)).toBe("░░░░░");
  });
  it("renders partial", () => {
    expect(progressBar(2, 5)).toBe("▓▓░░░");
  });
  it("renders full at end", () => {
    expect(progressBar(5, 5)).toBe("▓▓▓▓▓");
  });
  it("handles overflow", () => {
    expect(progressBar(8, 5)).toBe("▓▓▓▓▓");
  });
  it("handles zero total", () => {
    expect(progressBar(0, 0)).toBe("");
  });
});
