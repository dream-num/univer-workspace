import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { mySpacesQueryOptions } from "../../spaces/spaces.queries";
import { useI18n } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { Select } from "../../../shared/ui/select";
import { Tooltip } from "../../../shared/ui/tooltip";
import type { AgentMode, AgentSettings, DeepSeekThinking } from "../agent.types";
import { configuredProviders, useAgentClient } from "./client";
import { useAgentMessages } from "./messages";
import { ModelSettingsDialog } from "./model-settings";

export function useAgentModel(initial?: AgentSettings["model"]) {
  const client = useAgentClient();
  const initialModel = initial ? JSON.stringify([initial.providerId, initial.modelId]) : "";
  const initialThinking = initial?.thinking ?? "high";
  const [model, setModel] = useState(initialModel);
  const [thinking, setThinking] = useState<DeepSeekThinking>(initialThinking);
  const [settings, setSettings] = useState(false);
  useEffect(() => { setModel(initialModel); setThinking(initialThinking); }, [initialModel, initialThinking]);
  const providers = useQuery({ queryKey: ["agent-configured-providers", client.userId], queryFn: () => configuredProviders(client) });
  const choices = (providers.data ?? []).flatMap((provider) => provider.models.map((modelId) => ({
    value: JSON.stringify([provider.id, modelId]), label: `${provider.label} · ${modelId}`, provider, modelId,
  })));
  const selected = choices.find((choice) => choice.value === model) ?? choices.find((choice) => choice.modelId === choice.provider.defaultModel) ?? choices[0];
  return { providers, choices, selected, setModel, thinking, setThinking, settings, setSettings };
}
export function AgentModelControls({ mode, setMode, model, disabled, children }: {
  readonly children?: ReactNode;
  readonly mode: AgentMode;
  readonly setMode: (mode: AgentMode) => void;
  readonly model: ReturnType<typeof useAgentModel>;
  readonly disabled: boolean;
}) {
  const m = useAgentMessages();
  return <>
    <div className="agent-model-controls">
      {children}
      <Select aria-label={m.mode} value={mode} onValueChange={setMode} disabled={disabled} options={[{ value: "ask", label: m.ask }, { value: "auto", label: m.auto }]} />
      {model.selected ? <Select className="agent-model-select" aria-label={m.model} value={model.selected.value} onValueChange={model.setModel} options={model.choices} disabled={disabled} /> : null}
      {model.selected?.provider.kind === "deepseek" ? <Select aria-label={m.thinking} value={model.thinking} onValueChange={model.setThinking} disabled={disabled} options={[
        { value: "off", label: m.off }, { value: "high", label: m.high }, { value: "max", label: m.max },
      ]} /> : null}
      <Tooltip content={m.settings}><Button variant="ghost" size="icon" aria-label={m.settings} disabled={disabled} onClick={() => model.setSettings(true)}><Settings /></Button></Tooltip>
    </div>
    {model.providers.error ? <Alert variant="destructive">{model.providers.error.message}</Alert> : null}
    {model.settings ? <ModelSettingsDialog onClose={() => { model.setSettings(false); void model.providers.refetch(); }} /> : null}
  </>;
}
export function AgentRepositorySelect({ repository, setRepository, disabled }: {
  readonly repository: string;
  readonly setRepository: (repository: string) => void;
  readonly disabled: boolean;
}) {
  const m = useAgentMessages();
  const { t } = useI18n();
  const spaces = useQuery(mySpacesQueryOptions);
  return <>
    <div className="agent-scope"><Select aria-label={m.repository} value={repository || "auto"} onValueChange={(value) => setRepository(value === "auto" ? "" : value)} disabled={disabled} options={[
      { value: "auto", label: m.choice(m.repository, m.automatic) }, ...(spaces.data?.spaces ?? []).map((item) => ({ value: item.id, label: m.choice(m.repository, item.type === "personal" ? item.owner?.username ?? t("personalSpace") : item.name) })),
    ]} /></div>
    {spaces.error ? <Alert variant="destructive">{spaces.error.message}</Alert> : null}
  </>;
}
