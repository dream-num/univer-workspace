import { ChartColumn } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../../shared/i18n";
import { ACTOR_KINDS, type DailySeries, type DayKey, type SegmentKey } from "../data";
import { ACTOR_LABEL } from "./actor-avatar";
import { chartLayout } from "./chart-layout";

export function formatChartDay(day: DayKey, language: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString(language, {
    month: language === "zh-CN" ? "2-digit" : "short",
    day: language === "zh-CN" ? "2-digit" : "numeric",
  });
}

export function ActivityChart({
  series,
  range,
  onRangeChange,
  pickedDay,
  onPickDay,
}: {
  readonly series: DailySeries;
  readonly range: 7 | 14;
  readonly onRangeChange: (range: 7 | 14) => void;
  readonly pickedDay: DayKey | null;
  readonly onPickDay: (day: DayKey | null) => void;
}) {
  const { t, language } = useI18n();
  const id = useId();
  const plot = useRef<HTMLDivElement>(null);
  const hits = useRef(new Map<DayKey, SVGRectElement>());
  const [width, setWidth] = useState(300);
  const [hovered, setHovered] = useState<DayKey | null>(null);
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = chartLayout(series, width);
  const selected = series.days.find((day) => day.day === hovered);
  const selectedColumn = layout.columns.find((column) => column.day === hovered);
  const totals = new Map(ACTOR_KINDS
    .filter((kind) => series.days.some((day) => day.segments.some((segment) => segment.key === kind)))
    .map((kind) => [kind, 0]));
  for (const day of series.days)
    for (const segment of day.segments)
      totals.set(segment.key, (totals.get(segment.key) ?? 0) + segment.value);
  const merged = series.days.reduce((sum, day) => sum + day.merged, 0);
  const label = (key: SegmentKey) => t(ACTOR_LABEL[key]);
  const first = series.days[0]?.day;
  const last = series.days.at(-1)?.day;
  const pick = (day: DayKey) => onPickDay(pickedDay === day ? null : day);
  return (
    <section className="rd-card rd-chart" aria-labelledby={`${id}-title`}>
      <div className="rd-chart-h">
        <div>
          <h2 id={`${id}-title`}>
            <ChartColumn aria-hidden="true" />
            {t("repositoryChangeActivity")}
          </h2>
          <p>{t("repositoryActivityBasis")}</p>
        </div>
        <div className="rd-toggle" role="group" aria-label={t("repositoryActivityRange")}>
          {([7, 14] as const).map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={range === days}
              onClick={() => onRangeChange(days)}
            >
              {t("repositoryActivityDays", { count: days })}
            </button>
          ))}
        </div>
      </div>
      <div className="rd-chart-b">
        <div
          ref={plot}
          className={`rd-plot${pickedDay ? " rd-picked" : ""}${selected ? " rd-hovering" : ""}`}
          onMouseLeave={() => {
            if (!plot.current?.contains(document.activeElement)) setHovered(null);
          }}
        >
          <svg
            width={width}
            height={layout.height}
            viewBox={`0 0 ${width} ${layout.height}`}
            role="group"
            aria-label={t("repositoryChangeActivity")}
          >
            <line
              className="rd-lane"
              x1={layout.left}
              x2={layout.right}
              y1={layout.lane + 4}
              y2={layout.lane + 4}
            />
            {layout.ticks.map((tick) => (
              <g key={tick.value}>
                <line
                  className={tick.value ? "rd-grid" : "rd-base"}
                  x1={layout.left}
                  x2={layout.right}
                  y1={tick.y}
                  y2={tick.y}
                />
                <text x={layout.left - 8} y={tick.y + 4} textAnchor="end">
                  {tick.value}
                </text>
              </g>
            ))}
            {selectedColumn ? (
              <line
                className="rd-cursor"
                x1={selectedColumn.cx}
                x2={selectedColumn.cx}
                y1={layout.plotTop}
                y2={layout.baseline}
              />
            ) : null}
            {layout.columns.map((column, i) => (
              <g key={column.day}>
                <g
                  className={`rd-col${column.day === pickedDay ? " rd-pick" : ""}${column.day === hovered ? " rd-on" : ""}`}
                >
                  {column.rects
                    .filter((rect) => rect.value > 0)
                    .map((rect) => (
                      <rect
                        key={rect.key}
                        x={column.cx - layout.barWidth / 2}
                        y={rect.y}
                        width={layout.barWidth}
                        height={rect.height}
                        rx={2.5}
                        fill={`var(--rd-actor-${rect.key})`}
                      />
                    ))}
                  {column.merged > 0 ? (
                    <>
                      <rect
                        className="rd-mpill"
                        x={column.cx - 10}
                        y={column.mergedY}
                        width={20}
                        height={16}
                        rx={8}
                      />
                      <text className="rd-mn" x={column.cx} y={layout.lane} textAnchor="middle">
                        {column.merged}
                      </text>
                    </>
                  ) : null}
                </g>
                {i % layout.labelStride === 0 ? (
                  <text className="rd-x" x={column.cx} y={layout.height - 5} textAnchor="middle">
                    {formatChartDay(column.day, language)}
                  </text>
                ) : null}
              </g>
            ))}
            {layout.columns.map((column, i) => {
              const day = series.days[i];
              return (
                <rect
                  key={column.day}
                  ref={(element) => {
                    if (element) hits.current.set(column.day, element);
                    else hits.current.delete(column.day);
                  }}
                  className="rd-hit"
                  x={column.x}
                  y={0}
                  width={layout.slotWidth}
                  height={layout.baseline}
                  tabIndex={0}
                  role="button"
                  aria-pressed={pickedDay === column.day}
                  aria-label={`${formatChartDay(column.day, language)}, ${day?.segments.map((segment) => `${label(segment.key)} ${segment.value}`).join(", ")}, ${t("repositoryActivityMerged")} ${column.merged}`}
                  aria-describedby={hovered === column.day ? `${id}-tip` : undefined}
                  onMouseEnter={() => setHovered(column.day)}
                  onFocus={() => setHovered(column.day)}
                  onBlur={() => setHovered(null)}
                  onClick={() => pick(column.day)}
                  onKeyDown={(event) => {
                    if (
                      ["Enter", " ", "Escape", "ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      event.preventDefault();
                    if (event.key === "Enter" || event.key === " ") pick(column.day);
                    if (event.key === "Escape") {
                      onPickDay(null);
                      setHovered(null);
                    }
                    const next =
                      event.key === "ArrowLeft"
                        ? Math.max(0, i - 1)
                        : event.key === "ArrowRight"
                          ? Math.min(layout.columns.length - 1, i + 1)
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? layout.columns.length - 1
                              : undefined;
                    const nextDay = next === undefined ? undefined : layout.columns[next]?.day;
                    if (nextDay) hits.current.get(nextDay)?.focus();
                  }}
                />
              );
            })}
          </svg>
          {selected && selectedColumn ? (
            <div
              className="rd-tip"
              id={`${id}-tip`}
              role="tooltip"
              style={{ left: Math.max(0, Math.min(width - 190, selectedColumn.cx - 88)), top: 4 }}
            >
              <div className="rd-d">{formatChartDay(selected.day, language)}</div>
              {selected.segments.map((segment) => (
                <div className="rd-r" key={segment.key}>
                  <span className="rd-sw" style={{ background: `var(--rd-actor-${segment.key})` }} />
                  {label(segment.key)}
                  <span className="rd-num">{segment.value}</span>
                </div>
              ))}
              <div className="rd-r">
                <span className="rd-sw rd-m" />
                {t("repositoryActivityMerged")}
                <span className="rd-num">{selected.merged}</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="rd-legend">
          {[...totals].map(([key, total]) => (
            <div className="rd-r" key={key}>
              <span className="rd-sw" style={{ background: `var(--rd-actor-${key})` }} />
              {label(key)}
              <span className="rd-num">{total}</span>
            </div>
          ))}
          <div className="rd-r">
            <span className="rd-sw rd-m" />
            {t("repositoryActivityMerged")}
            <span className="rd-num">{merged}</span>
          </div>
          <p className="rd-note">
            {t("repositoryActivityDays", { count: range })}
            {first && last
              ? `, ${formatChartDay(first, language)} – ${formatChartDay(last, language)}`
              : ""}
            <br />
            <span>{t("repositoryActivityPickHint")}</span>
            {!series.complete ? (
              <>
                <br />
                {t("repositoryPartialData")}
              </>
            ) : null}
          </p>
        </div>
      </div>
    </section>
  );
}
