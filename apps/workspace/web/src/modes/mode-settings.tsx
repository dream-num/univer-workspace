import { useI18n } from "../shared/i18n";
import { useUiMode } from "../shared/ui-mode";
import { Segmented } from "../shared/ui";
import { MODE_IDS, modes } from "./registry";

export function ModeSettings() {
  const { t } = useI18n();
  const { mode, setMode } = useUiMode();
  return (
    <div className="grid gap-3 py-3.5">
      <span className="text-sm font-medium">{t("layoutTheme")}</span>
      <Segmented
        aria-label={t("layoutTheme")}
        size="sm"
        value={mode}
        onValueChange={setMode}
        options={MODE_IDS.map((id) => ({ label: t(modes[id].label), value: id }))}
      />
      <p className="text-xs text-muted-foreground">{t("repositoryHint")}</p>
    </div>
  );
}
