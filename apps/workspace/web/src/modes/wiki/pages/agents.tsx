import { useI18n } from "../../../shared/i18n";
import { WorkspaceLayout } from "../../workspace-layout";

export function WikiAgentsPage() {
  const { t } = useI18n();
  return <WorkspaceLayout headerTitle={t("agents")}><p className="p-6">{t("agentsRepositoryOnly")}</p></WorkspaceLayout>;
}
