import type { DailySeries } from "../data";

export function chartLayout(series: DailySeries, width: number) {
  const height = 196;
  const left = 26;
  const right = Math.max(left, width - 4);
  const lane = 22;
  const plotTop = lane + 12;
  const baseline = height - 24;
  const max = Math.max(1, ...series.days.map((day) => day.total));
  const rawStep = max / 3;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / power;
  const step = Math.max(
    1,
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power,
  );
  const top = Math.ceil(max / step) * step;
  const y = (value: number) => baseline - (value / top) * (baseline - plotTop);
  const slotWidth = (right - left) / Math.max(1, series.days.length);
  const barWidth = Math.min(slotWidth * 0.62, 36);
  return {
    height,
    left,
    right,
    lane,
    plotTop,
    baseline,
    slotWidth,
    barWidth,
    ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => ({
      value: i * step,
      y: y(i * step),
    })),
    labelStride: width / series.days.length > 52 ? 1 : width / series.days.length > 30 ? 2 : 3,
    columns: series.days.map((day, i) => {
      let total = 0;
      return {
        day: day.day,
        cx: left + (i + 0.5) * slotWidth,
        x: left + i * slotWidth,
        merged: day.merged,
        mergedY: lane - 12,
        rects: day.segments.map((segment) => {
          const bottom = y(total);
          total += segment.value;
          return {
            key: segment.key,
            value: segment.value,
            y: y(total),
            height: segment.value
              ? Math.max(bottom - y(total) - (total > segment.value ? 1.5 : 0), 1)
              : 0,
          };
        }),
      };
    }),
  };
}
