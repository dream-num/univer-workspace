import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getHtmlViewUnitIds, parseHtmlView } from "@univerjs-labs/html-view";
import { api } from "../../../shared/api/client";
import { apiError } from "../../../shared/api/errors";
import { Button } from "../../../shared/ui/button";
import { resourceOpenQueryOptions } from "../../resources";
import { spaceQueryOptions } from "../../spaces";
import type { PendingApproval } from "../runtime/approvals";
import { useAgentMessages } from "./messages";

const DraftPreview = lazy(() => import("./draft-preview").then((module) => ({ default: module.DraftPreview })));

export function ApprovalCard({ approval, disabled, onDecide }: {
  readonly approval: PendingApproval;
  readonly disabled: boolean;
  readonly onDecide: (approved: boolean) => void;
}) {
  const m = useAgentMessages();
  const { action } = approval;
  const [preview, setPreview] = useState(false);
  const [seen, setSeen] = useState(false);
  const markSeen = useCallback(() => setSeen(true), []);
  const current = useQuery({ ...resourceOpenQueryOptions(action.kind === "replace" ? action.resourceId : ""), enabled: action.kind === "replace" });
  const spaceId = action.kind === "create" ? action.spaceId : current.data?.resource.spaceId;
  const repository = useQuery(spaceQueryOptions(spaceId));
  const html = action.kind === "other" ? null : action.html;
  const sourceIds = useMemo(() => {
    if (html === null) return null;
    try { return getHtmlViewUnitIds(parseHtmlView(html)); } catch { return null; }
  }, [html]);
  const sources = useQueries({ queries: (sourceIds ?? []).map((unitId) => ({
    queryKey: ["unit-resources", unitId],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const { data, error } = await api.GET("/api/unit-resources/{unitId}", { params: { path: { unitId } }, signal });
      if (error) throw apiError(error);
      return data;
    },
  })) });
  const title = action.kind === "create" ? m.publishPage : action.kind === "replace" ? m.replacePage : m.publishAction;
  const name = action.kind === "create" ? action.name : action.kind === "replace" ? current.data?.resource.name ?? action.resourceId : approval.toolName;
  const destination = repository.data;
  const decide = (approved: boolean) => { setPreview(false); onDecide(approved); };
  return <section className="agent-approval" aria-label={title}>
    <h2>{title}</h2><strong>{name}</strong>
    <p className="agent-note">{m.publishNotice}</p>
    <dl>
      <dt>{m.repository}</dt><dd>{destination?.fullName ?? destination?.name ?? spaceId ?? m.loading}</dd>
      <dt>{m.scope}</dt><dd>{destination ? destination.publicRead ? m.publicPage : m.privatePage : m.unknownVisibility}</dd>
      <dt>{m.sourceSheets}</dt><dd>{sourceIds === null ? m.sourcesUnavailable : sourceIds.length === 0 ? m.noSourceSheets :
        sourceIds.map((id, index) => sources[index]?.data?.node.name ?? id).join(", ")}</dd>
    </dl>
    {action.kind === "other" && <pre>{JSON.stringify(action.input, null, 2)}</pre>}
    <div className="agent-approval-actions">
      {html !== null ? <Button variant="secondary" disabled={disabled} onClick={() => setPreview(true)}>{m.draftPreview}</Button> : <span>{m.previewUnavailable}</span>}
      <Button disabled={disabled || html !== null && !seen} onClick={() => decide(true)}>{m.publish}</Button>
      <Button variant="secondary" disabled={disabled} onClick={() => decide(false)}>{m.reject}</Button>
    </div>
    {html !== null && !seen && <p className="agent-note">{m.previewFirst}</p>}
    {preview && html !== null && <Suspense fallback={<p role="status">{m.loading}</p>}>
      <DraftPreview html={html} name={name} replacing={action.kind === "replace"}
        current={current.data?.resource.kind === "blob" ? current.data.resource : undefined}
        currentError={current.isError} disabled={disabled} onOpened={markSeen} onClose={() => setPreview(false)} onDecide={decide} />
    </Suspense>}
  </section>;
}
