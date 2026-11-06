import { describe, expect, it } from "vitest";
import { dayKeyOf, type DailySeries, type SeriesDay } from "../data";
import { segmentsOf } from "../data/actor";
import { chartLayout } from "./chart-layout";

const day = (at: string, people: number, agents: number, merged = 0): SeriesDay => ({
  day: dayKeyOf(at),
  segments: segmentsOf({ people, agents, unknown: 0 }),
  total: people + agents,
  merged,
});
const series = (days: readonly SeriesDay[]): DailySeries => ({ days, complete: true });

describe("chartLayout", () => {
  it("keeps empty and zero-activity charts finite with a readable scale", () => {
    for (const data of [series([]), series([day("2026-11-06", 0, 0)])]) {
      const layout = chartLayout(data, 300);
      expect(layout.ticks.map((tick) => tick.value)).toEqual([0, 1]);
      expect(layout.ticks.every((tick) => Number.isFinite(tick.y))).toBe(true);
      expect(
        layout.columns.flatMap((column) => column.rects).every((rect) => rect.height === 0),
      ).toBe(true);
    }
  });

  it("stacks the two segments beneath a separate merged lane without scaling by merged counts", () => {
    const layout = chartLayout(series([day("2026-11-06", 8, 6, 400)]), 500);
    expect(layout.ticks.map((tick) => tick.value)).toEqual([0, 5, 10, 15]);
    const column = layout.columns[0];
    expect(column?.rects.map((rect) => rect.key)).toEqual(["people", "agents"]);
    const [pulls, issues] = column?.rects ?? [];
    expect((pulls?.y ?? 0) + (pulls?.height ?? 0)).toBeCloseTo(layout.baseline);
    expect((issues?.y ?? 0) + (issues?.height ?? 0) + 1.5).toBeCloseTo(pulls?.y ?? 0);
    expect(column?.merged).toBe(400);
    expect((column?.mergedY ?? 0) + 16).toBeLessThan(layout.plotTop);
  });

  it("reflows bars and dates from the actual width at desktop and 390px mobile sizes", () => {
    const data = series(
      Array.from({ length: 14 }, (_, i) => day(`2026-11-${String(i + 1).padStart(2, "0")}`, i, 1)),
    );
    const wide = chartLayout(data, 800);
    const mobile = chartLayout(data, 300);
    expect(wide.labelStride).toBe(1);
    expect(mobile.labelStride).toBe(3);
    expect(mobile.barWidth).toBeLessThan(wide.barWidth);
    for (const layout of [wide, mobile, chartLayout(data, 10)]) {
      for (const column of layout.columns) {
        expect(column.cx - layout.barWidth / 2).toBeGreaterThanOrEqual(layout.left);
        expect(column.cx + layout.barWidth / 2).toBeLessThanOrEqual(layout.right);
        expect(
          column.rects.every(
            (rect) => rect.y >= layout.plotTop && rect.y + rect.height <= layout.baseline,
          ),
        ).toBe(true);
      }
    }
  });
});
