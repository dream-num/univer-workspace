import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { UnitFreshnessBadge } from "./unit-freshness";

vi.mock("../../shared/i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) => (values ? `${key}(${Object.values(values).join(", ")})` : key),
  }),
}));

const freshness = (label: "current" | "behind" | "stale", revisionsBehind: number) =>
  ({ label, revisionsBehind, baselineTrunkRevision: 4, addedAt: "2026-11-23T00:00:00.000Z" });
const badge = (value: ReturnType<typeof freshness> | null) =>
  renderToStaticMarkup(createElement(UnitFreshnessBadge, { freshness: value }));

it("marks a behind or stale Trunk file with its label and why, and leaves a current or new file unmarked", () => {
  expect(badge(freshness("behind", 3))).toContain('aria-label="unitBehind(3). unitBehindHint(3)"');
  expect(badge(freshness("stale", 0))).toContain('aria-label="unitStale. unitStaleHint"');
  expect(badge(freshness("current", 0))).toBe("");
  expect(badge(null)).toBe("");
});
