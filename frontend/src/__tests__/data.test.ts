import { describe, expect, it } from "vitest";
import { compactFormat, lineData, revenueFormat } from "../data";

describe("форматтеры", () => {
  it("compactFormat сокращает числа", () => {
    expect(compactFormat(1_500)).toMatch(/1,5/);
  });

  it("revenueFormat добавляет валюту", () => {
    expect(revenueFormat(1_234)).toContain("₽");
    expect(revenueFormat(1_234)).toContain("1");
  });
});

describe("lineData", () => {
  it("возвращает ровно запрошенное число точек", () => {
    expect(lineData(7)).toHaveLength(7);
    expect(lineData(30)).toHaveLength(30);
  });

  it("детерминирован (одинаковый результат при повторном вызове)", () => {
    expect(lineData(14)).toEqual(lineData(14));
  });

  it("ключи уникальны и значения неотрицательны", () => {
    const points = lineData(30);
    const keys = points.map((point) => point.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const point of points) {
      expect(point.values.current).toBeGreaterThanOrEqual(0);
      expect(point.values.previous).toBeGreaterThanOrEqual(0);
    }
  });
});
