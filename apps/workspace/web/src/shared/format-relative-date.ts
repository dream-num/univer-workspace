import type { AppLanguage } from "./i18n";

export function formatRelativeDate(
  value: string,
  language: AppLanguage
): string {
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const dayDifference = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000
  );
  const time = date.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (dayDifference === 0) {
    return language === "zh-CN" ? `今天 ${time}` : `Today ${time}`;
  }
  if (dayDifference === 1) {
    return language === "zh-CN"
      ? `昨天 ${time}`
      : `Yesterday ${time}`;
  }
  return date.toLocaleDateString(language, {
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "short",
    day: "numeric",
  });
}
