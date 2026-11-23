import { getHtmlViewUnitIds, parseHtmlView, type HtmlViewDocument } from "@univerjs-labs/html-view";
import { Sheet, ShieldCheck, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuRoot, MenuTrigger, Segmented } from "../../../shared/ui";
import type { HtmlViewSourceWorktree } from "../workspace-binding-engine";
import { unitLabel, useBoundUnits, type BoundUnits } from "./bound-units";
import { CheckedPreview, type PreviewWriteMode } from "./checked-preview";
import { FilePicker } from "./file-picker";
import { usePreviewMessages } from "./messages";
import { buildReport, postReport, type LocalPreviewReport } from "./report";
import type { PreviewSearch } from "./source";
import { alwaysTrusted, forget, trustAlways, trustedUnits, trustForSession, trustKey } from "./trust";
import { TrustStep } from "./trust-step";
import { usePreviewPage, type PreviewLoad } from "./use-preview-page";

type Viewport = "fit" | "360" | "390" | "1440";

function parse(html: string): { document: HtmlViewDocument } | { error: string } {
  try { return { document: parseHtmlView(html) }; } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

export function LocalPreview({ search, worktree, userId }: {
  search: PreviewSearch;
  worktree: HtmlViewSourceWorktree | undefined;
  /** Whose always-trusted Sheets apply. Without it, trust lasts only for this run. */
  userId: string | undefined;
}) {
  const m = usePreviewMessages();
  const loader = usePreviewPage(search);
  const [writeMode, setWriteMode] = useState<PreviewWriteMode>("trial");
  const [confirmingWrite, setConfirmingWrite] = useState(false);
  const [viewport, setViewport] = useState<Viewport>("fit");
  const [, trustChanged] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const pick = () => { void loader.choose().then((handled) => { if (!handled) input.current?.click(); }); };
  const host = !loader.isFile && search.src !== undefined;
  const deliver = useCallback(async (report: LocalPreviewReport) => host && search.src ? postReport(search.src, report) : null, [host, search.src]);
  const page = loader.state.status === "ready" ? loader.state.page : null;
  const parsed = useMemo(() => page ? parse(page.html) : null, [page?.html]);
  const unitIds = useMemo(() => parsed && "document" in parsed ? getHtmlViewUnitIds(parsed.document) : [], [parsed]);
  const token = host ? search.token ?? "local" : "local";
  const units = useBoundUnits(page?.html, worktree);

  useEffect(() => {
    if (!page || !parsed || !("error" in parsed)) return;
    void deliver(buildReport({ token, sha256: page.sha256, writeMode: "trial", bindings: [], leftoverPlaceholders: [], viewport: { width: 0, height: 0 },
      renderCheck: { status: "failed", issues: [{ kind: "viewer-error", message: parsed.error.slice(0, 300) }], durationMs: 0 } }));
  }, [page?.sha256, parsed]);

  const sourceLabel = host ? `${m.sourceHost} · ${new URL(search.src!).host}` : m.sourceFile;
  const pullRequest = search.repo !== undefined && search.pr !== undefined ? { repo: search.repo, pr: search.pr } : undefined;
  const key = page ? trustKey(host ? search : {}, page.name) : "";
  const trustedSet = trustedUnits(key, userId);
  const trusted = page !== null && parsed !== null && "document" in parsed && unitIds.every((id) => trustedSet.has(id));

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
        {units.size > 0 && <TrustMenu units={units} always={new Set(userId ? alwaysTrusted(userId) : [])}
          onForget={(unitId) => { forget(userId!, unitId); trustChanged((n) => n + 1); }} />}
      </>}
    </header>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {page === null ? <Gate state={loader.state} loader={loader} pick={pick} fileName={search.file} origin={host ? new URL(search.src!).origin : ""} noSource={!host && !loader.isFile} /> :
        parsed && "error" in parsed ? <p role="alert" className="m-6 text-destructive">{m.parseFailed(parsed.error)}</p> :
        !trusted ? <TrustStep bindings={parsed!.document.bindings} units={units} trusted={trustedSet} fileName={page.name} source={sourceLabel}
          pullRequest={pullRequest} canAlways={userId !== undefined} pick={pick}
          onTrust={(scope) => { if (scope === "always") trustAlways(userId!, unitIds); else trustForSession(key, unitIds.filter((id) => !trustedSet.has(id))); trustChanged((n) => n + 1); }} /> :
        <CheckedPreview key={`${page.generation}:${writeMode}:${viewport}`} page={page} bindings={parsed!.document.bindings} unitIds={unitIds} units={units} token={token}
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
      <p className="m-0">{m.errorSafari}</p>
      <ul className="m-0 list-none break-all p-0 text-xs text-muted-foreground">
        <li><code>{m.errorChromeLink(window.location.origin)}</code></li><li><code>{m.errorEdgeLink(window.location.origin)}</code></li>
      </ul>
    </> : <p role="alert" className="m-0 text-destructive">{state.kind === "refused" ? m.errorRefused(state.httpStatus ?? 0) : m.errorFailed(state.message)}</p>}
    <div className="flex gap-2"><Button onClick={loader.start}>{m.retry}</Button></div>
    <FilePicker loader={loader} pick={pick} variant="secondary" />
  </div>;
}

function TrustMenu({ units, always, onForget }: { units: BoundUnits; always: ReadonlySet<string>; onForget: (unitId: string) => void }) {
  const m = usePreviewMessages();
  return <MenuRoot>
    <MenuTrigger render={<button type="button" className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full bg-success-soft px-2 text-xs font-medium text-success-soft-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-3" />}>
      <ShieldCheck />{m.trusted}
    </MenuTrigger>
    <MenuContent align="end" className="w-72">
      <MenuGroup>
        <MenuGroupLabel>{m.trustedMenu}</MenuGroupLabel>
        {[...units.values()].map((unit) => always.has(unit.unitId)
          ? <MenuItem key={unit.unitId} onClick={() => onForget(unit.unitId)}><ShieldOff />{m.forget(unitLabel(unit, m))}</MenuItem>
          : <div key={unit.unitId} className="flex items-center gap-2 px-2 py-1.5 text-sm text-subtle-foreground">
            <Sheet className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{unitLabel(unit, m)}</span>{m.sessionOnly}
          </div>)}
      </MenuGroup>
    </MenuContent>
  </MenuRoot>;
}
