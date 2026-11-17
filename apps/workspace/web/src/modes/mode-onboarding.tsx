import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useI18n, type AppLanguage } from "../shared/i18n";
import { Button, Select } from "../shared/ui";
import { useUiMode } from "../shared/ui-mode";
import { ModeChoiceCards } from "./mode-choice-cards";

export function ModeOnboarding() {
  const { language, setLanguage, t } = useI18n();
  const { mode, setMode } = useUiMode();
  const [selected, setSelected] = useState(mode);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4 py-6 sm:px-8">
      <form
        className="w-full max-w-4xl rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-9"
        onSubmit={(event) => {
          event.preventDefault();
          setMode(selected);
        }}
      >
        <header className="mb-6 flex items-start justify-between gap-3">
          <h1 id="view-choice-title" className="text-2xl font-semibold tracking-tight text-foreground">
            {t("chooseWorkspaceView")}
          </h1>
          <Select<AppLanguage>
            aria-label={t("language")}
            value={language}
            onValueChange={setLanguage}
            options={[
              { value: "zh-CN", label: t("chinese") },
              { value: "en-US", label: t("english") },
            ]}
            size="sm"
            borderless
            className="w-auto shrink-0 text-xs font-normal text-muted-foreground"
          />
        </header>
        <fieldset aria-labelledby="view-choice-title" aria-describedby="view-choice-hint" className="min-w-0">
          <ModeChoiceCards value={selected} onChange={setSelected} />
        </fieldset>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <p id="view-choice-hint" className="m-0 max-w-lg text-sm text-muted-foreground">
            {t("workspaceViewHint")}
          </p>
          <Button type="submit" size="lg">
            {t("enterWorkspace")}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </form>
    </main>
  );
}
