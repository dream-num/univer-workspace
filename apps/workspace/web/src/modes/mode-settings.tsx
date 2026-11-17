import { useI18n } from "../shared/i18n";
import { useUiMode } from "../shared/ui-mode";
import { ModeChoiceCards } from "./mode-choice-cards";

export function ModeSettings() {
  const { t } = useI18n();
  const { mode, setMode } = useUiMode();
  return (
    <fieldset className="min-w-0 pb-3.5">
      <legend className="mb-2 text-sm font-medium">{t("workspaceView")}</legend>
      <ModeChoiceCards compact value={mode} onChange={setMode} />
    </fieldset>
  );
}
