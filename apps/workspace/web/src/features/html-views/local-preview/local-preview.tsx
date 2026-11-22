import { getHtmlViewUnitIds, parseHtmlView, type HtmlViewDocument } from "@univerjs-labs/html-view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog, Segmented } from "../../../shared/ui";
import type { HtmlViewSourceWorktree } from "../workspace-binding-engine";
import { CheckedPreview, type PreviewWriteMode } from "./checked-preview";
import { FilePicker } from "./file-picker";
import { usePreviewMessages } from "./messages";
import { buildReport, postReport, type LocalPreviewReport } from "./report";
import type { PreviewSearch } from "./source";
import { isTrusted, remember, trustKey } from "./trust";
import { TrustStep } from "./trust-step";
import { usePreviewPage, type PreviewLoad } from "./use-preview-page";

type Viewport = "fit" | "360" | "390" | "1440";

function parse(html: string): { document: HtmlViewDocument } | { error: string } {
  try { return { document: parseHtmlView(html) }; } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

export function LocalPreview({ search, worktree }: { search: PreviewSearch; worktree: HtmlViewSourceWorktree | undefined }) {
  const m = usePreviewMessages();
  const loader = usePreviewPage(search);
  const [writeMode, setWriteMode] = useState<PreviewWriteMode>("trial");
  const [confirmingWrite, setConfirmingWrite] = useState(false);
  const [viewport, setViewport] = useState<Viewport>("fit");
  const [, confirmed] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const pick = () => { void loader.choose().then((handled) => { if (!handled) input.current?.click(); }); };
  const host = !loader.isFile && search.src !== undefined;
  const deliver = useCallback(async (report: LocalPreviewReport) => host && search.src ? postReport(search.src, report) : null, [host, search.src]);
  const page = loader.state.status === "ready" ? loader.state.page : null;
  const parsed = useMemo(() => page ? parse(page.html) : null, [page?.html]);
  const unitIds = useMemo(() => parsed && "document" in parsed ? getHtmlViewUnitIds(parsed.document) : [], [parsed]);
  const token = host ? search.token ?? "local" : "local";

  useEffect(() => {
    if (!page || !parsed || !("error" in parsed)) return;
    void deliver(buildReport({ token, sha256: page.sha256, writeMode: "trial", bindings: [], leftoverPlaceholders: [], viewport: { width: 0, height: 0 },
      renderCheck: { status: "failed", issues: [{ kind: "viewer-error", message: parsed.error.slice(0, 300) }], durationMs: 0 } }));
  }, [page?.sha256, parsed]);

  const sourceLabel = host ? `${m.sourceHost} · ${new URL(search.src!).origin}` : m.sourceFile;
  const key = page ? trustKey(host ? search : {}, page.name) : "";
  const trusted = page !== null && parsed !== null && "document" in parsed && isTrusted(key, unitIds);

  return <main className="flex h-dvh min-h-0 flex-col">
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2 text-sm">
      <h1 className="m-0 text-base font-semibold">{m.title}</h1>
      {page && <span className="text-muted-foreground">{page.name} · {sourceLabel}</span>}
      {trusted && <>
        <span role="status" data-write-mode={worktree ? "trial" : writeMode}
          className={writeMode === "saved" && !worktree ? "rounded bg-destructive/10 px-2 py-0.5 text-destructive" : "rounded bg-amber-50 px-2 py-0.5 text-amber-950"}>
          {worktree ? m.writePrTrial : writeMode === "trial" ? m.writeTrial : m.writeSaved}
        </span>
        {!worktree && (writeMode === "trial"
          ? <ConfirmDialog open={confirmingWrite} onOpenChange={setConfirmingWrite} danger title={m.writeConfirmTitle} description={m.writeConfirmBody}
              confirmText={m.writeConfirm} cancelText={m.cancel} onConfirm={() => setWriteMode("saved")}
              trigger={<Button variant="secondary" size="sm">{m.writeSwitch}</Button>} />
          : <Button variant="secondary" size="sm" onClick={() => setWriteMode("trial")}>{m.writeBack}</Button>)}
        <Segmented<Viewport> aria-label={m.viewport} size="sm" value={viewport} onValueChange={setViewport}
          options={[{ value: "fit", label: m.viewportFit }, { value: "360", label: "360" }, { value: "390", label: "390" }, { value: "1440", label: "1440" }]} />
        {loader.isFile && <>
          <span className="text-muted-foreground">{loader.watching ? m.pickWatching : loader.stale ? m.pickStale : m.pickOnce}</span>
          <Button variant="secondary" size="sm" onClick={pick}>{m.pickAnother}</Button>
        </>}
      </>}
    </header>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {page === null ? <Gate state={loader.state} loader={loader} pick={pick} fileName={search.file} origin={host ? new URL(search.src!).origin : ""} noSource={!host && !loader.isFile} /> :
        parsed && "error" in parsed ? <p role="alert" className="m-6 text-destructive">{m.parseFailed(parsed.error)}</p> :
        !trusted ? <TrustStep html={page.html} bindings={parsed!.document.bindings} fileName={page.name} sourceLabel={sourceLabel} worktree={worktree}
          onConfirm={() => { remember(key, unitIds); confirmed((n) => n + 1); }} pick={pick} /> :
        <CheckedPreview key={`${page.generation}:${writeMode}`} page={page} bindings={parsed!.document.bindings} unitIds={unitIds} token={token}
          writeMode={worktree ? "trial" : writeMode} worktree={worktree && writeMode === "trial" ? worktree : undefined}
          viewportWidth={viewport === "fit" ? null : Number(viewport)} deliver={deliver} />}
    </div>
    <input ref={input} type="file" accept=".html,.htm,text/html" className="hidden" data-testid="preview-file-input"
      onChange={(event) => { loader.pickInput(event.target.files?.[0]); event.target.value = ""; }} />
  </main>;
}

function Gate({ state, loader, pick, fileName, origin, noSource }: {
  state: PreviewLoad; loader: ReturnType<typeof usePreviewPage>; pick: () => void; fileName: string | undefined; origin: string; noSource: boolean;
}) {
  const m = usePreviewMessages();
  if (noSource) return <div className="mx-auto w-full max-w-xl p-6"><FilePicker loader={loader} pick={pick} /></div>;
  if (state.status === "idle") return <section aria-labelledby="preview-gate-title" className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6 text-sm">
    <h2 id="preview-gate-title" className="m-0 text-lg font-semibold">{m.gateTitle}</h2>
    <p className="m-0">{m.gateBody}</p>
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {fileName && <><dt className="text-muted-foreground">{m.file}</dt><dd className="m-0 break-all">{fileName}</dd></>}
      <dt className="text-muted-foreground">{m.source}</dt><dd className="m-0 break-all">{m.sourceHost} · {origin}</dd>
    </dl>
    <div className="flex gap-2">
      <Button onClick={loader.start}>{m.gateLoad}</Button>
      <Button variant="secondary" onClick={pick}>{m.pickFile}</Button>
    </div>
  </section>;
  if (state.status === "loading") return <p role="status" className="p-6">{m.loading}</p>;
  if (state.status !== "error") return null;
  return <div className="mx-auto flex w-full max-w-xl flex-col gap-3 p-6 text-sm">
    {state.kind === "blocked" ? <>
      <h2 role="alert" className="m-0 text-base font-semibold">{m.errorBlockedTitle}</h2>
      <p className="m-0">{m.errorBlockedCauses}</p>
      <p className="m-0">{m.errorBlockedFix}</p>
      <ul className="m-0 list-none break-all p-0 text-xs text-muted-foreground">
        <li><code>{m.errorChromeLink(window.location.origin)}</code></li><li><code>{m.errorEdgeLink(window.location.origin)}</code></li>
      </ul>
    </> : <p role="alert" className="m-0 text-destructive">{state.kind === "refused" ? m.errorRefused(state.httpStatus ?? 0) : m.errorFailed(state.message)}</p>}
    <div className="flex gap-2"><Button onClick={loader.start}>{m.retry}</Button></div>
    <FilePicker loader={loader} pick={pick} variant="secondary" />
  </div>;
}
