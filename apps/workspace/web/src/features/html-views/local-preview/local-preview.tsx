import { getHtmlViewUnitIds, parseHtmlView, type HtmlViewDocument } from "@univerjs-labs/html-view";
import { CircleX, CodeXml, FileText, FileUp, FlaskConical, Monitor, PenLine, Sheet, ShieldCheck, ShieldOff, Unplug } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, ConfirmDialog, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuRoot, MenuTrigger, Segmented } from "../../../shared/ui";
import type { HtmlViewSourceWorktree } from "../workspace-binding-engine";
import { unitLabel, useBoundUnits, type BoundUnits } from "./bound-units";
import { CheckedPreview, type PreviewWriteMode } from "./checked-preview";
import { FilePicker } from "./file-picker";
import { usePreviewMessages } from "./messages";
import { buildReport, postReport, type LocalPreviewReport } from "./report";
import type { PreviewSearch } from "./source";
import { PageBox, PullRequestChip, StepCard, StepLink, StepNote } from "./step-card";
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

  const saving = writeMode === "saved" && !worktree;
  const divider = <span aria-hidden="true" className="h-4.5 w-px shrink-0 bg-border-strong" />;
  const origin = host ? new URL(search.src!) : undefined;
  const fileName = page?.name ?? search.file;

  return <main className="flex h-dvh min-h-0 flex-col">
    <header className="flex min-h-13 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2 text-sm">
      <div className="flex shrink-0 items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary"><CodeXml className="size-3.5" /></span>
        <h1 className="m-0 text-sm font-semibold">{m.title}</h1>
      </div>
      {divider}
      <div className="flex min-w-0 flex-1 basis-40 items-center gap-1.5 text-muted-foreground">
        {fileName && <><FileText className="size-3.5 shrink-0" /><span title={fileName} className="min-w-0 truncate font-medium text-foreground">{fileName}</span></>}
        {origin ? <Badge title={`${m.sourceHost} ${origin.origin}`}><Monitor />{m.sourceChip(origin.port)}</Badge>
          : loader.isFile && <Badge><FileUp />{m.sourceFile}</Badge>}
        {pullRequest && <PullRequestChip {...pullRequest} />}
      </div>
      {trusted && <div className="flex flex-wrap items-center gap-2.5">
        <Badge role="status" data-write-mode={worktree ? "trial" : writeMode} variant={saving ? "danger" : "warning"}>
          {saving ? <PenLine /> : <FlaskConical />}{worktree ? m.writePrTrial : saving ? m.writeSaved : m.writeTrial}
        </Badge>
        {!worktree && (writeMode === "trial"
          ? <ConfirmDialog open={confirmingWrite} onOpenChange={setConfirmingWrite} danger title={m.writeConfirmTitle} description={m.writeConfirmBody}
              confirmText={m.writeConfirm} cancelText={m.cancel} onConfirm={() => setWriteMode("saved")}
              trigger={<Button variant="secondary" size="sm">{m.writeSwitch}</Button>} />
          : <Button variant="secondary" size="sm" onClick={() => setWriteMode("trial")}>{m.writeBack}</Button>)}
        {divider}
        <Segmented<Viewport> aria-label={m.viewport} size="sm" value={viewport} onValueChange={setViewport}
          options={[{ value: "fit", label: m.viewportFit }, { value: "360", label: "360" }, { value: "390", label: "390" }, { value: "1440", label: "1440" }]} />
        {loader.isFile && <>
          {divider}
          <span className="text-xs text-muted-foreground">{loader.watching ? m.pickWatching : loader.stale ? m.pickStale : m.pickOnce}</span>
          <Button variant="secondary" size="sm" onClick={pick}>{m.pickAnother}</Button>
        </>}
        {units.size > 0 && <>
          {divider}
          <TrustMenu units={units} always={new Set(userId ? alwaysTrusted(userId) : [])} onForget={(unitId) => { forget(userId!, unitId); trustChanged((n) => n + 1); }} />
        </>}
      </div>}
    </header>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {page === null ? <Gate state={loader.state} loader={loader} pick={pick} fileName={search.file ?? "page.html"} source={sourceLabel} pullRequest={pullRequest}
          noSource={!host && !loader.isFile} /> :
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

function Gate({ state, loader, pick, fileName, source, pullRequest, noSource }: {
  state: PreviewLoad; loader: ReturnType<typeof usePreviewPage>; pick: () => void;
  fileName: string; source: string; pullRequest: { repo: string; pr: number } | undefined; noSource: boolean;
}) {
  const m = usePreviewMessages();
  if (noSource) return <StepCard icon={FileUp} title={m.pickTitle}><FilePicker loader={loader} pick={pick} /></StepCard>;
  if (state.status === "loading") return <p role="status" className="p-6">{m.loading}</p>;
  if (state.status === "idle") return <StepCard icon={Monitor} title={m.gateTitle} lead={m.gateLead}
    footer={<><Button onClick={loader.start}>{m.gateLoad}</Button><StepLink onClick={pick}>{m.gatePick}</StepLink></>}>
    <PageBox name={fileName} source={source} pullRequest={pullRequest} />
    <StepNote>{m.gateChrome}</StepNote>
  </StepCard>;
  if (state.status !== "error") return null;
  const retry = <Button onClick={loader.start}>{m.retry}</Button>;
  if (state.kind !== "blocked") return <StepCard icon={CircleX} title={m.errorTitle} footer={retry}
    lead={<span role="alert">{state.kind === "refused" ? m.errorRefused(state.httpStatus ?? 0) : state.message}</span>}>
    <FilePicker loader={loader} pick={pick} variant="secondary" />
  </StepCard>;
  return <StepCard icon={Unplug} title={m.errorBlockedTitle} lead={<span role="alert">{m.errorBlockedCauses}</span>} footer={retry}>
    <div className="flex flex-col gap-2 leading-relaxed">
      <p className="m-0">{m.errorBlockedFix}</p>
      <p className="m-0">{m.errorSafari}</p>
    </div>
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs break-all text-subtle-foreground">
      <li><code>{m.errorChromeLink(window.location.origin)}</code></li><li><code>{m.errorEdgeLink(window.location.origin)}</code></li>
    </ul>
    <FilePicker loader={loader} pick={pick} variant="secondary" />
  </StepCard>;
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
