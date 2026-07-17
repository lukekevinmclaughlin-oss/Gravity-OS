import { describe, expect, it } from "vitest";
import { evaluate, formatNumber, fuzzyScore, looksLikeMath, rank } from "../lib/search";

describe("evaluate", () => {
  it("handles precedence", () => {
    expect(evaluate("2+2*3")).toBe(8);
    expect(evaluate("(3+4)/2")).toBe(3.5);
    expect(evaluate("10%3")).toBe(1);
  });
  it("handles powers right-associatively", () => {
    expect(evaluate("2^10")).toBe(1024);
    expect(evaluate("2^3^2")).toBe(512);
  });
  it("handles unary minus and decimals", () => {
    expect(evaluate("-5+3")).toBe(-2);
    expect(evaluate("1,5*2")).toBe(3);
  });
  it("rejects garbage and non-finite results", () => {
    expect(evaluate("2++")).toBeNull();
    expect(evaluate("abc")).toBeNull();
    expect(evaluate("1/0")).toBeNull();
    expect(evaluate("(2+3")).toBeNull();
    expect(evaluate("")).toBeNull();
  });
});

describe("looksLikeMath", () => {
  it("wants an operator beyond a leading sign", () => {
    expect(looksLikeMath("5+5")).toBe(true);
    expect(looksLikeMath("5")).toBe(false);
    expect(looksLikeMath("-5")).toBe(false);
    expect(looksLikeMath("mail")).toBe(false);
  });
});

describe("fuzzyScore + rank", () => {
  it("prefers prefix over substring over subsequence", () => {
    const prefix = fuzzyScore("ma", "Mail")!;
    const substring = fuzzyScore("ai", "Mail")!;
    const subsequence = fuzzyScore("ml", "Mail")!;
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
  });
  it("returns null when letters are missing", () => {
    expect(fuzzyScore("xyz", "Mail")).toBeNull();
  });
  it("ranks with boosts", () => {
    const items = [
      { name: "Paint", running: false },
      { name: "Photos", running: true },
    ];
    const out = rank("p", items, (i) => i.name, (i) => (i.running ? 10 : 0));
    expect(out[0].name).toBe("Photos");
  });
});

describe("formatNumber", () => {
  it("groups integers and trims floats", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(3.5)).toBe("3.5");
  });
});
