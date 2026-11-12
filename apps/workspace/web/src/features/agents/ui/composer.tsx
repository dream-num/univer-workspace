import type { components } from "../../../../../generated/http/schema.js";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUp, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sessionQueryOptions } from "../../auth";
import { mySpacesQueryOptions, spaceQueryOptions } from "../../spaces/spaces.queries";
import { worktreePagesQueryOptions } from "../../worktrees/worktrees.queries";
import { useI18n } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { Select } from "../../../shared/ui/select";
import { Textarea } from "../../../shared/ui/textarea";
import { Tooltip } from "../../../shared/ui/tooltip";
import type { AgentMode, DeepSeekThinking } from "../agent.types";
import { useAgentClient, configuredProviders } from "./client";
import { useAgentMessages } from "./messages";
import { ModelSettingsDialog } from "./model-settings";

export function AgentComposer({ spaceId, starter, focus }: { readonly spaceId?: string; readonly starter?: { readonly text: string } | null; readonly focus?: boolean }) {
  const m = useAgentMessages();
  const { t } = useI18n();
  const client = useAgentClient();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AgentMode>("ask");
  const [thinking, setThinking] = useState<DeepSeekThinking>("high");
  const [repository, setRepository] = useState("");
  const [base, setBase] = useState("");
  const [model, setModel] = useState("");
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLElement>(null);
  const session = useQuery(sessionQueryOptions);
  const displayName = session.data?.authenticated ? session.data.user.displayName : undefined;
  const spaces = useQuery({ ...mySpacesQueryOptions, enabled: !spaceId });
  const space = useQuery(spaceQueryOptions(spaceId));
  const providers = useQuery({ queryKey: ["agent-configured-providers", client.userId], queryFn: () => configuredProviders(client) });
  const choices = (providers.data ?? []).flatMap((provider) => provider.models.map((modelId) => ({
    value: JSON.stringify([provider.id, modelId]), label: `${provider.label} · ${modelId}`, provider, modelId,
  })));
  const selected = choices.find((choice) => choice.value === model) ?? choices.find((choice) => choice.modelId === choice.provider.defaultModel) ?? choices[0];
  useEffect(() => { if (starter) { setText(starter.text); input.current?.querySelector("textarea")?.focus(); } }, [starter]);
  useEffect(() => { if (focus) input.current?.querySelector("textarea")?.focus(); }, [focus]);
  async function send() {
    if (!selected) { setSettings(true); return; }
    if (!text.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const session = await (await client.runner()).start({
        scope: spaceId ? { kind: "repository", spaceId, baseWorktreeId: base || null }
          : repository ? { kind: "repository", spaceId: repository, baseWorktreeId: null } : { kind: "global" },
        mode, model: { providerId: selected.provider.id, modelId: selected.modelId, thinking: selected.provider.kind === "deepseek" ? thinking : null }, text: text.trim(),
      });
      await navigate({ to: "/agents/$sessionId", params: { sessionId: session.id } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return (
    <section ref={input} className="agent-composer" aria-label={m.agents}>
      <header className="agent-greeting"><h2>{m.greeting(displayName)}</h2><p>{m.greetingHint}</p></header>
      {spaceId ? <RepositoryBase spaceId={spaceId} base={base} setBase={setBase} /> : <div className="agent-scope">
        <span>{m.repository}</span><Select aria-label={m.repository} value={repository} onValueChange={setRepository} options={[
          { value: "", label: m.automatic }, ...(spaces.data?.spaces ?? []).map((item) => ({ value: item.id, label: item.type === "personal" ? item.owner?.username ?? t("personalSpace") : item.name })),
        ]} />
      </div>}
      <div className="agent-composer-box">
        <Textarea id="agent-composer" aria-label={m.prompt} placeholder={m.prompt} value={text} disabled={busy} rows={3}
          onFocus={() => { void client.prewarm().catch((cause: unknown) => setError(String(cause))); }}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (!event.nativeEvent.isComposing && (event.shiftKey || event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void send(); } }} />
        <div className="agent-composer-controls">
          <div className="agent-model-controls">
            <Select aria-label={m.mode} value={mode} onValueChange={setMode} options={[{ value: "ask", label: m.ask }, { value: "auto", label: m.auto }]} />
            {selected ? <Select className="agent-model-select" aria-label={m.model} value={selected.value} onValueChange={setModel} options={choices} /> : null}
            {selected?.provider.kind === "deepseek" ? <Select aria-label={m.thinking} value={thinking} onValueChange={setThinking} options={[
              { value: "off", label: m.off }, { value: "high", label: m.high }, { value: "max", label: m.max },
            ]} /> : null}
            <Tooltip content={m.settings}><Button variant="ghost" size="icon" aria-label={m.settings} onClick={() => setSettings(true)}><Settings /></Button></Tooltip>
          </div>
          <Button className="agent-send" aria-keyshortcuts="Shift+Enter" aria-label={selected ? m.send : m.setup} disabled={busy || Boolean(selected && !text.trim())} onClick={() => void send()}>
            {selected ? <><ArrowUp aria-hidden="true" /><span>{m.send}</span><kbd aria-hidden="true">⇧↵</kbd></> : m.setup}
          </Button>
        </div>
      </div>
      <p className="agent-note">{mode === "ask" ? m.askHint : m.autoHint}</p>
      {space.error || spaces.error || providers.error ? <Alert variant="destructive">{(space.error ?? spaces.error ?? providers.error)?.message}</Alert> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {settings ? <ModelSettingsDialog onClose={() => { setSettings(false); void providers.refetch(); }} /> : null}
    </section>
  );
}
function RepositoryBase({ spaceId, base, setBase }: { readonly spaceId: string; readonly base: string; readonly setBase: (value: string) => void }) {
  const m = useAgentMessages();
  const space = useQuery(spaceQueryOptions(spaceId));
  return space.data ? <BaseChoices space={space.data} base={base} setBase={setBase} /> : <p role="status">{m.loading}</p>;
}
function BaseChoices({ space, base, setBase }: { readonly space: components["schemas"]["SpaceView"]; readonly base: string; readonly setBase: (value: string) => void }) {
  const m = useAgentMessages();
  const pulls = useInfiniteQuery(worktreePagesQueryOptions(space.type === "team" ? { teamSpaceId: space.id } : { kind: "user" }));
  return <div className="agent-scope"><span>{m.basedOn}</span><Select aria-label={m.basedOn} value={base} onValueChange={setBase} options={[
    { value: "", label: m.newPr }, ...(pulls.data?.pages.flatMap((page) => page.items) ?? []).filter((pull) => pull.state === "draft" || pull.state === "ready").map((pull) => ({ value: pull.id, label: `#${pull.number} ${pull.name}` })),
  ]} />{pulls.hasNextPage ? <Button variant="secondary" disabled={pulls.isFetchingNextPage} onClick={() => void pulls.fetchNextPage()}>{m.more}</Button> : null}{pulls.error ? <Alert variant="destructive">{pulls.error.message}</Alert> : null}</div>;
}
