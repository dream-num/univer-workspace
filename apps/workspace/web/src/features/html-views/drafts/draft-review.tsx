import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getHtmlViewUnitIds, parseHtmlView } from "@univerjs-labs/html-view";
import { api } from "../../../shared/api/client";
import { ApiError, apiError } from "../../../shared/api/errors";
import { Button } from "../../../shared/ui/button";
import { Textarea } from "../../../shared/ui/textarea";
import { nodeQueryOptions } from "../../nodes/nodes.queries";
import { resourceOpenQueryOptions } from "../../resources/resources.queries";
import { spaceQueryOptions } from "../../spaces/spaces.queries";
import { draftContentQueryOptions, htmlViewDraftQueryOptions, usePublishDraft, useRejectDraft, type HtmlViewDraft } from "./draft-queries";
import { useDraftMessages } from "./messages";

const DraftPreview = lazy(() => import("./draft-preview").then((module) => ({ default: module.DraftPreview })));
const DraftVersions = lazy(() => import("./draft-preview").then((module) => ({ default: module.DraftVersions })));

type Presentation = "page" | "card";

export function HtmlViewDraftReview({ draftId, presentation, replaced = false, onRequestChanges, requestChangesDisabled = false }: {
  readonly draftId: string;
  readonly presentation: Presentation;
  readonly replaced?: boolean;
  readonly onRequestChanges?: ((message: string) => void) | undefined;
  readonly requestChangesDisabled?: boolean;
}) {
  const m = useDraftMessages();
  const draft = useQuery(htmlViewDraftQueryOptions(draftId));
  return <section className={presentation === "page" ? "flex h-dvh min-h-0 flex-col bg-background text-foreground" : "rounded-xl border border-border bg-background p-5 text-foreground"} aria-label={m.draft}>
    {draft.isError ? <p role="alert" className="p-5">{draft.error instanceof ApiError && draft.error.code === "NOT_FOUND" ? m.notFound : draft.error.message}</p> :
      !draft.data ? <p role="status" className="p-5">{m.loading}</p> :
        draft.data.state === "pending" && replaced ? <div className="p-5">
          <h1 className="text-lg font-semibold">{draft.data.name}</h1><p role="status">{m.replaced}</p>
        </div> : draft.data.state === "pending" ? <PendingDraft key={draftId} draft={draft.data} presentation={presentation}
          onRequestChanges={presentation === "card" ? onRequestChanges : undefined} requestChangesDisabled={requestChangesDisabled} /> :
          <div className="p-5">
            <h1 className="text-lg font-semibold">{draft.data.name}</h1>
            <p role="status">{m[draft.data.state]}</p>
            {draft.data.state === "published" && draft.data.published && <a className="text-primary underline" href={`/nodes/${encodeURIComponent(draft.data.published.nodeId)}?view=immersive`}>{m.openPage}</a>}
          </div>}
  </section>;
}

function PendingDraft({ draft, presentation, onRequestChanges, requestChangesDisabled }: {
  readonly draft: HtmlViewDraft;
  readonly presentation: Presentation;
  readonly onRequestChanges: ((message: string) => void) | undefined;
  readonly requestChangesDisabled: boolean;
}) {
  const m = useDraftMessages();
  const content = useQuery(draftContentQueryOptions(draft.id));
  const current = useQuery({ ...resourceOpenQueryOptions(draft.targetResourceId ?? ""), enabled: draft.kind === "replace" && draft.targetResourceId !== null });
  const repository = useQuery(spaceQueryOptions(draft.spaceId));
  const parent = useQuery({ ...nodeQueryOptions(draft.parentNodeId ?? ""), enabled: draft.parentNodeId !== null });
  const publish = usePublishDraft(draft.id);
  const reject = useRejectDraft(draft.id);
  const [preview, setPreview] = useState(false);
  const [seen, setSeen] = useState(false);
  const [changes, setChanges] = useState<string | null>(null);
  const markSeen = useCallback(() => setSeen(true), []);
  const sourceIds = useMemo(() => {
    if (content.data === undefined) return null;
    try { return getHtmlViewUnitIds(parseHtmlView(content.data)); } catch { return null; }
  }, [content.data]);
  const sources = useQueries({ queries: (sourceIds ?? []).map((unitId) => ({
    queryKey: ["unit-resources", unitId],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const { data, error } = await api.GET("/api/unit-resources/{unitId}", { params: { path: { unitId } }, signal });
      if (error) throw apiError(error);
      return data;
    },
  })) });
  const disabled = publish.isPending || reject.isPending;
  const error = publish.error ?? reject.error ?? content.error;
  const decide = (approved: boolean) => {
    if (disabled) return;
    setPreview(false);
    if (approved) publish.mutate(); else reject.mutate();
  };
  const openChanges = () => { setPreview(false); setChanges((value) => value ?? ""); };
  async function requestChanges() {
    if (!onRequestChanges || disabled || requestChangesDisabled || !changes?.trim()) return;
    const message = m.changeDraftMessage(draft.name, changes.trim());
    try { await reject.mutateAsync(); }
    catch { return; }
    onRequestChanges(message);
  }
  const destination = repository.data;
  const previewProps = {
    html: content.data ?? "", replacing: draft.kind === "replace",
    current: current.data?.resource.kind === "blob" ? current.data.resource : undefined,
    currentError: current.isError,
  };
  return <>
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border p-5">
      <div className="min-w-0 break-words">
        <h1 className="text-lg font-semibold">{draft.name}</h1>
        <p className="text-sm text-muted-foreground">{draft.kind === "create" ? m.publishPage : m.replacePage} · {m.pending}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt>{m.repository}</dt><dd>{destination?.fullName ?? destination?.name ?? draft.spaceId}</dd>
          <dt>{m.destination}</dt><dd>{draft.parentNodeId === null ? m.root : parent.data?.node.name ?? draft.parentNodeId}</dd>
          <dt>{m.scope}</dt><dd>{destination ? destination.publicRead ? m.publicPage : m.privatePage : m.unknownVisibility}</dd>
          <dt>{m.sourceSheets}</dt><dd>{sourceIds === null ? m.sourcesUnavailable : sourceIds.length === 0 ? m.noSourceSheets : sourceIds.map((id, index) => sources[index]?.data?.node.name ?? id).join(", ")}</dd>
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">{m.publishNotice}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {presentation === "card" && <Button variant="secondary" disabled={content.data === undefined || disabled} onClick={() => setPreview(true)}>{m.draftPreview}</Button>}
        <Button disabled={disabled || presentation === "card" && !seen} onClick={() => decide(true)}>{m.publish}</Button>
        <Button variant="secondary" disabled={disabled} onClick={() => decide(false)}>{m.reject}</Button>
        {onRequestChanges && <Button variant="secondary" disabled={disabled || requestChangesDisabled} onClick={openChanges}>{m.requestChanges}</Button>}
      </div>
    </header>
    {error && <p role="alert" className="p-5 text-destructive">{error.message}</p>}
    {changes !== null && onRequestChanges && <form className="space-y-3 p-5" onSubmit={(event) => { event.preventDefault(); void requestChanges(); }}>
      <label className="block space-y-2 text-sm">{m.changeReason}
        <Textarea autoFocus value={changes} rows={3} disabled={disabled || requestChangesDisabled} onChange={(event) => setChanges(event.target.value)} />
      </label>
      <Button type="submit" disabled={disabled || requestChangesDisabled || !changes.trim()}>{m.sendChanges}</Button>
    </form>}
    {presentation === "card" && !seen && <p className="mt-3 text-sm text-muted-foreground">{m.previewFirst}</p>}
    {presentation === "page" && (content.data === undefined ? <p role="status" className="p-5">{content.isPending ? m.loading : m.previewUnavailable}</p> :
      <Suspense fallback={<p role="status">{m.loading}</p>}><DraftVersions {...previewProps} /></Suspense>)}
    {presentation === "card" && preview && content.data !== undefined && <Suspense fallback={<p role="status">{m.loading}</p>}>
      <DraftPreview {...previewProps} name={draft.name} disabled={disabled} onOpened={markSeen} onClose={() => setPreview(false)} onDecide={decide}
        onRequestChanges={onRequestChanges ? openChanges : undefined} requestChangesDisabled={requestChangesDisabled} />
    </Suspense>}
  </>;
}
