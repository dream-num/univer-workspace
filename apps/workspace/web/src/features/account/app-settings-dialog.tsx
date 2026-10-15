import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../shared/i18n";
import { useTheme } from "../../shared/theme";
import { Dialog, Segmented } from "../../shared/ui";

export function AppSettingsDialog({ open, onOpenChange, layoutSettings }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly layoutSettings: ReactNode;
}) {
  const { language, setLanguage, t } = useI18n();
  const { theme, setTheme } = useTheme();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("appSettings")}
      width="sm"
    >
      <div className="-my-1 divide-y divide-border">
        {layoutSettings}
        <div className="flex items-center justify-between gap-4 py-3.5 max-[440px]:flex-col max-[440px]:items-start max-[440px]:gap-2.5">
          <span className="text-sm font-medium">{t("language")}</span>
          <Segmented
            aria-label={t("language")}
            size="sm"
            value={language}
            onValueChange={setLanguage}
            options={[
              { label: t("chinese"), value: "zh-CN" },
              { label: t("english"), value: "en-US" },
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-3.5 max-[440px]:flex-col max-[440px]:items-start max-[440px]:gap-2.5">
          <span className="text-sm font-medium">{t("theme")}</span>
          <Segmented
            aria-label={t("theme")}
            size="sm"
            value={theme}
            onValueChange={setTheme}
            options={[
              {
                label: (
                  <>
                    <Sun />
                    {t("themeLight")}
                  </>
                ),
                value: "light",
              },
              {
                label: (
                  <>
                    <Moon />
                    {t("themeDark")}
                  </>
                ),
                value: "dark",
              },
              {
                label: (
                  <>
                    <Monitor />
                    {t("themeSystem")}
                  </>
                ),
                value: "system",
              },
            ]}
          />
        </div>
      </div>
    </Dialog>
  );
}
