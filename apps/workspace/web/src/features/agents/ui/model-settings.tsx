import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { Dialog } from "../../../shared/ui/dialog";
import { Field } from "../../../shared/ui/field";
import { Input } from "../../../shared/ui/input";
import type { ProviderConfig } from "../agent.types";
import { providerConfigSchema, providerIdSchema } from "../agent.types";
import { deepSeekDefault, redactProviderError } from "../providers";
import { configuredProviders, useAgentClient } from "./client";
import { useAgentMessages } from "./messages";

export function ModelSettingsDialog({ onClose }: { readonly onClose: () => void }) {
  const m = useAgentMessages();
  const client = useAgentClient();
  const providers = useQuery({ queryKey: ["agent-providers", client.userId], queryFn: () => client.providers.list() });
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const savedProviders = providers.data ?? [];
  const unsavedDraft = draft && !savedProviders.some((provider) => provider.id === draft.id) ? draft : null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={m.settings} description={m.privacy} width="xl">
      <p className="mb-4 text-sm text-muted-foreground">{m.limit}</p>
      {providers.isPending ? <p role="status">{m.loading}</p> : null}
      {providers.error ? <Alert variant="destructive">{providers.error.message}</Alert> : null}
      <div className="grid gap-4">
        {[...savedProviders, ...(unsavedDraft ? [unsavedDraft] : [])].map((provider) => <ProviderForm key={provider.id} provider={provider} />)}
        <Button variant="secondary" disabled={unsavedDraft !== null} onClick={() => setDraft({
          id: providerIdSchema.parse(crypto.randomUUID()), kind: "openai-compatible", label: "", baseURL: "", models: [], defaultModel: "",
        })}>{m.add}</Button>
      </div>
    </Dialog>
  );
}

function ProviderForm({ provider }: { readonly provider: ProviderConfig }) {
  const m = useAgentMessages();
  const client = useAgentClient();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(provider.label);
  const [baseURL, setBaseURL] = useState(provider.baseURL);
  const [models, setModels] = useState(provider.models.join(", "));
  const [defaultModel, setDefaultModel] = useState(provider.defaultModel);
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saved = useQuery({ queryKey: ["agent-key-status", provider.id, client.userId], queryFn: async () => {
    try { await client.providers.resolve(provider.id); return true; } catch (cause) {
      if (cause instanceof Error && cause.message === "No API key configured for this provider") return false;
      throw cause;
    }
  } });
  async function action(kind: "save" | "test" | "remove") {
    setBusy(true); setError(""); setNotice("");
    try {
      if (kind === "remove") { await client.providers.clearKey(provider.id); setKey(""); }
      else {
        const config = provider.kind === "deepseek" ? deepSeekDefault : providerConfigSchema.parse({
          ...provider, label: label.trim(), baseURL: baseURL.trim(), models: models.split(",").map((value) => value.trim()).filter(Boolean), defaultModel: defaultModel.trim(),
        });
        await client.providers.save(config);
        if (key.trim()) await client.providers.setKey(provider.id, key.trim(), remember);
        if (kind === "test") {
          const result = await client.providers.testConnection(provider.id);
          if (!result.ok) throw new Error(result.message);
          setNotice(m.connected);
        } else setNotice(m.savedSettings);
        setKey("");
      }
      await queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("agent-") });
    } catch (cause) { setError(redactProviderError(cause, key.trim())); }
    finally { setBusy(false); }
  }
  return (
    <form className="grid gap-3 rounded-lg border border-border p-4" onSubmit={(event) => { event.preventDefault(); void action("save"); }}>
      <fieldset disabled={busy} className="grid gap-3">
        <legend className="mb-3 font-semibold">{provider.kind === "deepseek" ? "DeepSeek" : label || m.add}</legend>
        {provider.kind === "openai-compatible" ? <>
          <Field label={m.label}><Input aria-label={m.label} required value={label} onChange={(event) => setLabel(event.target.value)} /></Field>
          <Field label={m.baseURL}><Input aria-label={m.baseURL} type="url" required value={baseURL} onChange={(event) => setBaseURL(event.target.value)} /></Field>
          <Field label={m.models}><Input aria-label={m.models} required value={models} onChange={(event) => setModels(event.target.value)} /></Field>
          <Field label={m.defaultModel}><Input aria-label={m.defaultModel} required value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} /></Field>
        </> : null}
        <Field label={m.key}>
          <Input aria-label={m.key} type="password" autoComplete="new-password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={saved.data ? m.saved : m.noKey} />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={remember} onChange={(event) => setRemember(event.target.checked)} />{m.remember}</label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{m.save}</Button>
          <Button variant="secondary" onClick={() => void action("test")}>{m.test}</Button>
          <Button variant="secondary" disabled={!saved.data} onClick={() => void action("remove")}>{m.removeKey}</Button>
        </div>
      </fieldset>
      {saved.error ? <Alert variant="destructive">{saved.error.message}</Alert> : null}
      {notice ? <p role="status" className="flex items-center gap-2 text-success"><CircleCheck className="size-4" aria-hidden="true" />{notice}</p> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </form>
  );
}

export function AgentAccountDialog({ action, onClose, onLogout }: {
  readonly action: "settings" | "logout";
  readonly onClose: () => void;
  readonly onLogout: () => void;
}) {
  return action === "settings" ? <ModelSettingsDialog onClose={onClose} /> : <AgentSignOut onClose={onClose} onLogout={onLogout} />;
}
function AgentSignOut({ onClose, onLogout }: { readonly onClose: () => void; readonly onLogout: () => void }) {
  const m = useAgentMessages();
  const client = useAgentClient();
  const [hasKeys, setHasKeys] = useState(false);
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const started = useRef(false);
  async function finish(remove: boolean) {
    setBusy(true);
    try {
      await client.stopAll();
      if (remove) await client.providers.clearAllKeys();
      onLogout(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void configuredProviders(client).then((providers) => {
      if (providers.length) { setHasKeys(true); setBusy(false); } else void finish(false);
    }).catch(() => { onLogout(); onClose(); });
  }, [client]);
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }} title={m.signOut} description={hasKeys ? m.signOutHint : m.loading}
      footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>{m.cancel}</Button><Button disabled={busy} onClick={() => void finish(clear)}>{m.signOut}</Button></>}>
      {hasKeys ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={clear} onChange={(event) => setClear(event.target.checked)} />{m.clearKeys}</label> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </Dialog>
  );
}
