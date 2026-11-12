import type { components } from "../../../../../generated/http/schema.js";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUp, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { sessionQueryOptions } from "../../auth";
import { spaceQueryOptions } from "../../spaces/spaces.queries";
import { worktreePagesQueryOptions } from "../../worktrees/worktrees.queries";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { Select } from "../../../shared/ui/select";
import type { RangeSelection } from "lexical";
import type { AgentReference, AgentMode } from "../agent.types";
import { useAgentClient } from "./client";
import { useAgentMessages } from "./messages";
import { AgentReferencePicker } from "./references";
import { ComposerEditor, insertComposerReference } from "./composer-editor";
import type { ComposerEditorHandle } from "./composer-editor";
import { AgentModelControls, AgentRepositorySelect, useAgentModel } from "./composer-settings";

export function AgentComposer({ spaceId, starter, focus }: { readonly spaceId?: string; readonly starter?: { readonly text: string } | null; readonly focus?: boolean }) {
  const m = useAgentMessages();
  const client = useAgentClient();
  const navigate = useNavigate();
  const [{ text, references }, setContent] = useState<{ text: string; references: AgentReference[] }>({ text: "", references: [] });
  const [picker, setPicker] = useState<{ trigger: RangeSelection | null } | null>(null);
  const [mode, setMode] = useState<AgentMode>("ask");
  const [repository, setRepository] = useState("");
  const [base, setBase] = useState("");
  const model = useAgentModel();
  const { selected, thinking } = model;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<ComposerEditorHandle | null>(null);
  const session = useQuery(sessionQueryOptions);
  const displayName = session.data?.authenticated ? session.data.user.displayName : undefined;
  const space = useQuery(spaceQueryOptions(spaceId));
  function closePicker() { setPicker(null); input.current?.editor.focus(); }
  function chooseReference(reference: AgentReference) {
    if (input.current) insertComposerReference(input.current, reference, picker?.trigger ?? null);
    setPicker(null);
  }
  async function send() {
    if (!selected) { model.setSettings(true); return; }
    if (!text.trim() || busy) return;
    setBusy(true); setError(""); setPicker(null);
    try {
      const session = await (await client.runner()).start({
        scope: spaceId ? { kind: "repository", spaceId, baseWorktreeId: base || null }
          : repository ? { kind: "repository", spaceId: repository, baseWorktreeId: null } : { kind: "global" },
        references, mode, model: { providerId: selected.provider.id, modelId: selected.modelId, thinking: selected.provider.kind === "deepseek" ? thinking : null }, text: text.trim(),
      });
      setPicker(null);
      await navigate({ to: "/agents/$sessionId", params: { sessionId: session.id } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return (
    <section className="agent-composer" aria-label={m.agents}>
      <header className="agent-greeting"><h2>{m.greeting(displayName)}</h2><p>{m.greetingHint}</p></header>
      <div className="agent-composer-box">
        {picker ? <AgentReferencePicker spaceId={spaceId} onChoose={chooseReference} onClose={closePicker} /> : null}
        <ComposerEditor handle={input} label={m.prompt} busy={busy} {...(starter !== undefined ? { starter } : {})} {...(focus !== undefined ? { focus } : {})}
          onChange={setContent} onTrigger={(trigger) => setPicker({ trigger })} onSend={() => void send()}
          onFocus={() => { void client.prewarm().catch((cause: unknown) => setError(String(cause))); }} />
        <div className="agent-composer-controls">
          <Button variant="ghost" size="icon" aria-label={m.addContext} aria-expanded={picker !== null} disabled={busy} onClick={() => picker ? closePicker() : setPicker({ trigger: null })}><Plus aria-hidden="true" /></Button>
          <AgentModelControls mode={mode} setMode={setMode} model={model} disabled={busy}>
            {spaceId ? <RepositoryBase spaceId={spaceId} base={base} setBase={setBase} /> : <AgentRepositorySelect repository={repository} setRepository={setRepository} disabled={busy} />}
          </AgentModelControls>
          <Button className="agent-send" aria-keyshortcuts="Enter" aria-label={selected ? m.send : m.setup} disabled={busy || Boolean(selected && !text.trim())} onClick={() => void send()}>
            {selected ? <><ArrowUp aria-hidden="true" /><span>{m.send}</span><kbd aria-hidden="true">↵</kbd></> : m.setup}
          </Button>
        </div>
      </div>
      <p className="agent-note">{mode === "ask" ? m.askHint : m.autoHint}</p>
      {space.error ? <Alert variant="destructive">{space.error.message}</Alert> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
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
  return <div className="agent-scope"><Select aria-label={m.basedOn} value={base || "new"} onValueChange={(value) => setBase(value === "new" ? "" : value)} options={[
    { value: "new", label: m.choice(m.basedOn, m.newPr) }, ...(pulls.data?.pages.flatMap((page) => page.items) ?? []).filter((pull) => pull.state === "draft" || pull.state === "ready").map((pull) => ({ value: pull.id, label: m.choice(m.basedOn, `#${pull.number} ${pull.name}`) })),
  ]} />{pulls.hasNextPage ? <Button variant="secondary" disabled={pulls.isFetchingNextPage} onClick={() => void pulls.fetchNextPage()}>{m.more}</Button> : null}{pulls.error ? <Alert variant="destructive">{pulls.error.message}</Alert> : null}</div>;
}
