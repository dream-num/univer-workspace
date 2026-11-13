import { useEffect, useRef, useState } from "react";
import { MarkdownViewer } from "@univerjs/univer-workspace-markdown-viewer";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CheckCircle2, ChevronRight, FileCode2, FileQuestion, FileText, Files, FolderOpen, Info } from "lucide-react";
import { ApiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { Button, Segmented, Skeleton } from "../../shared/ui";
import { spaceQueryOptions } from "../spaces/spaces.queries";
import { skillBaseFileQueryOptions, skillContentQueryOptions, skillDraftQueryOptions, skillPreviewQueryOptions, useSkillDraftDecision } from "./draft-queries";
import { useSkillDraftMessages } from "./messages";
import { draftProvenance, groupFindings, lineDiff, type skillPreview, type SkillDraft } from "./review-model";
import { collapseFindings, compatibilityStates, draftFileChange, draftStates, findingSeverities, formatSkillFileSize, reviewRules, skillFilesForReview } from "./review-presentation";

type FileSelection = { path: string; line: number | null };
function fileId(path: string) { return `skill-file-${encodeURIComponent(path)}`; }

export function SkillDraftState({ state }: { readonly state: SkillDraft["state"] }) {
  const { language } = useI18n();
  const presentation = draftStates[state];
  return <span className="skill-state-chip" data-tone={presentation.tone}>{presentation.label[language]}</span>;
}

export function SkillDraftReview({ draftId }: { readonly draftId: string }) {
  const m = useSkillDraftMessages();
  const draft = useQuery(skillDraftQueryOptions(draftId));
  return <div className="skill-draft">
    {draft.isError ? <div className="skill-empty" role="alert">
      <FileQuestion aria-hidden="true" />
      <h1>{m.notFoundTitle}</h1>
      <p>{draft.error instanceof ApiError && draft.error.code === "NOT_FOUND" ? m.notFound : draft.error.message}</p>
      <a href="/agents">{m.backToAgents}</a>
    </div> : !draft.data ? <DraftSkeleton /> : <Review key={draftId} draft={draft.data} />}
  </div>;
}

function DraftSkeleton() {
  const m = useSkillDraftMessages();
  return <div className="skill-skeleton" role="status" aria-label={m.loading}>
    <Skeleton className="h-4 w-64 max-w-full" /><Skeleton className="h-9 w-80 max-w-full" />
    <Skeleton className="h-5 w-2/3" /><Skeleton className="h-28 w-full" />
    <div className="skill-review-layout"><div><Skeleton className="h-32 w-full" /><Skeleton className="mt-6 h-64 w-full" /></div><Skeleton className="h-64 w-full" /></div>
  </div>;
}

function Review({ draft }: { readonly draft: SkillDraft }) {
  const m = useSkillDraftMessages();
  const { language } = useI18n();
  const destination = useQuery(spaceQueryOptions(draft.spaceId));
  const decision = useSkillDraftDecision(draft.id);
  const pending = draft.state === "pending";
  const content = useQuery({ ...skillContentQueryOptions(draft.id, "SKILL.md", "draft"), enabled: pending });
  const preview = useQuery(skillPreviewQueryOptions(draft.id, draft.name, pending ? content.data ?? undefined : undefined));
  const [selection, setSelection] = useState<FileSelection | null>(null);
  const groups = groupFindings(draft);
  const source = draftProvenance(draft.source);
  const blocked = groups.block.length > 0 || draft.compatibility === "blocked";
  const verdict = compatibilityStates[blocked ? "blocked" : draft.compatibility];
  const VerdictIcon = pending ? verdict.icon : draftStates[draft.state].icon;
  const scripts = draft.scan.filter((finding) => finding.rule === "script-file").length;
  const summary = blocked ? m.blockedSummary(groups.block.length) : scripts ? m.scriptsSummary(scripts) : draft.compatibility === "degraded" ? m.degradedSummary : m.readySummary;
  const personal = destination.data?.type === "personal";
  const destinationLabel = personal ? m.personal : m.repository;
  const selected = draft.files.find((file) => file.path === (selection?.path ?? "SKILL.md"));
  const remainingHours = Math.max(0, (Date.parse(draft.expiresAt) - Date.now()) / 3_600_000);
  return <>
    <header className="skill-review-heading">
      <div className="skill-destination"><FolderOpen aria-hidden="true" /><a href={`/spaces/${encodeURIComponent(draft.spaceId)}`}>{personal ? m.personal : destination.data?.fullName ?? destination.data?.name ?? draft.spaceId}</a><span>/</span><code>.agents/skills/{draft.name}</code></div>
      <div className="skill-title-row"><h1>{draft.name}</h1><SkillDraftState state={draft.state} /></div>
      {preview.data?.description && <p className="skill-description">{preview.data.description}</p>}
      <div className="skill-metadata">
        <span><span className="skill-scope-badge">{destinationLabel}</span></span>
        <span className="skill-provenance">{source ? <>
          {source.href ? <a href={source.href} target="_blank" rel="noreferrer">{m.sourceHub[source.hub]}<ArrowUpRight aria-hidden="true" /></a> : m.sourceHub[source.hub]}
          {draft.source?.kind === "git" ? <><code>{draft.source.owner}/{draft.source.repo}</code><code title={draft.source.commit}>{draft.source.commit.slice(0, 7)}</code><code>{draft.source.path}</code></> : draft.source?.kind === "clawhub" ? <code>{draft.source.version}</code> : null}
        </> : m.agent}</span>
        <span><code>{draft.files.length}</code> {m.files(draft.files.length)}</span>
        <span>{m.created} <time dateTime={draft.createdAt}>{new Date(draft.createdAt).toLocaleString(language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></span>
        {pending && <span title={new Date(draft.expiresAt).toLocaleString(language)}>{m.timeLeft(remainingHours)}</span>}
      </div>
    </header>
    <section className="skill-decision" role={pending ? undefined : "status"} aria-label={m.decision} data-tone={pending ? verdict.tone : draftStates[draft.state].tone}>
      <div className="skill-decision-main">
        <div className="skill-verdict"><VerdictIcon aria-hidden="true" /><div><h2>{pending ? verdict.label[language] : draftStates[draft.state].label[language]}</h2><p id={pending && blocked ? "skill-publish-blocked" : undefined}>{pending ? summary : draftStates[draft.state].banner[language]}</p></div></div>
        {pending ? <div className="skill-decision-actions">
          <Button disabled={blocked || decision.isPending} aria-describedby={blocked ? "skill-publish-blocked" : undefined} onClick={() => decision.mutate("publish")}>{m.publish}</Button>
          <Button variant="secondary" disabled={decision.isPending} onClick={() => decision.mutate("reject")}>{m.reject}</Button>
        </div> : draft.state === "published" && draft.published ? <a className="skill-folder-link" href={`/nodes/${encodeURIComponent(draft.published.folderNodeId)}`}><FolderOpen aria-hidden="true" />{m.openFolder}<ArrowUpRight aria-hidden="true" /></a> : null}
      </div>
      {pending ? <div className="skill-decision-notes">
        {destination.data?.type === "team" && <p>{m.memberNotice}</p>}
        <p>{m.publishNotice}</p>
      </div> : draft.state === "published" ? <p className="skill-invoke-hint">{m.invokeHint.before} <span className="agent-skill-invocation"><code>/{draft.name}</code></span> {m.invokeHint.after}</p> : null}
      {[decision.error, destination.error, preview.error].filter((error) => error !== null).map((error, index) => <p className="skill-decision-error" role="alert" key={index}><Info aria-hidden="true" />{error.message}</p>)}
    </section>
    {pending && <div className="skill-review-layout">
      <div className="skill-review-main">
        <Checks draft={draft} onSelect={setSelection} />
        {selected ? <DraftFile key={selected.path} draft={draft} file={selected} preview={preview.data} selection={selection} /> : selection && <BaseFileViewer key={selection.path} draft={draft} path={selection.path} />}
      </div>
      <aside className="skill-review-aside">
        <nav className="skill-file-list skill-frame" id="skill-files" aria-label={m.filesTitle}>
          <h2 className="skill-panel-head"><Files aria-hidden="true" />{m.filesTitle}<span className="skill-count">{draft.files.length}</span>{draft.kind === "replace" && <span className="skill-files-summary"><code>{draft.removedPaths.length}</code> {m.change.removed} · <code>{draft.keep.length}</code> {m.change.kept}</span>}</h2>
          <ul>{skillFilesForReview(draft.files).map((file) => <li key={file.path}><button type="button" aria-current={(selection?.path ?? "SKILL.md") === file.path ? "true" : undefined} onClick={() => { setSelection({ path: file.path, line: null }); document.getElementById("skill-viewer")?.scrollIntoView({ block: "start" }); }}>
            <span className="skill-kind-tile">{file.kind === "binary" ? <Files aria-hidden="true" /> : file.path.endsWith(".md") ? <FileText aria-hidden="true" /> : <FileCode2 aria-hidden="true" />}</span>
            <span className="skill-file-facts"><code>{file.path}</code><span><code>{formatSkillFileSize(file.byteSize)}</code>{draft.kind === "replace" && <span className="skill-change" data-change={draftFileChange(draft, file)}>{m.change[draftFileChange(draft, file)]}</span>}</span></span>
          </button></li>)}
          {(["removed", "kept"] as const).flatMap((change) => (change === "removed" ? draft.removedPaths : draft.keep).map((path) => <BaseFileRow key={path} draftId={draft.id} path={path} change={change} selected={selection?.path === path} onSelect={() => setSelection({ path, line: null })} />))}</ul>
        </nav>
      </aside>
    </div>}
  </>;
}

function Checks({ draft, onSelect }: { readonly draft: SkillDraft; readonly onSelect: (selection: FileSelection) => void }) {
  const m = useSkillDraftMessages();
  const { language } = useI18n();
  const groups = groupFindings(draft);
  const findings = collapseFindings(draft);
  function locationLink(location: FileSelection) {
    return <a key={`${location.path}:${location.line}`} href={`#${fileId(location.path)}${location.line === null ? "" : `-${location.line}`}`} onClick={(event) => { event.preventDefault(); onSelect(location); }}><code>{location.path}{location.line === null ? "" : `:${location.line}`}</code></a>;
  }
  return <section className="skill-checks skill-frame" aria-label={m.findings}>
    <div className="skill-panel-head"><h2>{m.findings}</h2><div className="skill-check-counts">{(["block", "warn", "info"] as const).filter((severity) => groups[severity].length > 0).map((severity) => { const presentation = findingSeverities[severity]; return <span key={severity} data-tone={presentation.tone} title={presentation.label[language]}><presentation.icon aria-hidden="true" /><span className="sr-only">{presentation.label[language]}</span><span className="skill-count">{groups[severity].length}</span></span>; })}</div></div>
    {!findings.length ? <p className="skill-check-empty"><CheckCircle2 aria-hidden="true" />{m.noIssues}</p> : <ul className="skill-check-list">{findings.map(({ finding, locations }, index) => {
      const severity = findingSeverities[finding.severity];
      return <li key={index} className="skill-check-row" data-tone={severity.tone}>
        <severity.icon className="skill-check-icon" aria-label={severity.label[language]} />
        <div className="skill-check-content"><h3>{reviewRules[finding.rule][language]}{locations.length > 1 && <span className="skill-count">{locations.length}</span>}</h3>
          {"message" in finding ? <p>{finding.message}</p> : <><blockquote>{finding.quote}</blockquote><dl className="skill-review-evidence"><div><dt>{m.impact}</dt><dd>{finding.impact}</dd></div><div><dt>{m.suggestion}</dt><dd>{finding.suggestion}</dd></div></dl></>}
          {locations.length === 1 ? locationLink(locations[0]!) : <details><summary><ChevronRight aria-hidden="true" />{m.locations(locations.length)}</summary><ul className="skill-finding-paths">{locations.map((location) => <li key={`${location.path}:${location.line}`}>{locationLink(location)}</li>)}</ul></details>}
        </div>
      </li>;
    })}</ul>}
    {draft.unverifiedReviewCount > 0 && <p className="skill-check-footer"><Info aria-hidden="true" /><span><code>{draft.unverifiedReviewCount}</code> {m.unverified}. {m.unverifiedNotice}</span></p>}
  </section>;
}

function DraftFile({ draft, file, preview, selection }: { readonly draft: SkillDraft; readonly file: SkillDraft["files"][number]; readonly preview: Awaited<ReturnType<typeof skillPreview>> | undefined; readonly selection: FileSelection | null }) {
  const m = useSkillDraftMessages();
  const { language } = useI18n();
  const [view, setView] = useState<"preview" | "source" | "diff">(selection?.line != null ? "source" : file.path === "SKILL.md" ? "preview" : "source");
  const viewer = useRef<HTMLElement>(null);
  const content = useQuery({ ...skillContentQueryOptions(draft.id, file.path, "draft"), enabled: file.kind === "text" });
  const hasCurrent = draft.base?.some((base) => base.path === file.path) ?? false;
  const current = useQuery({ ...skillContentQueryOptions(draft.id, file.path, "current"), enabled: hasCurrent && file.kind === "text" && view === "diff" });
  useEffect(() => {
    if (!selection) return;
    if (selection.line !== null) setView("source");
    else { viewer.current?.scrollIntoView({ block: "start" }); viewer.current?.focus({ preventScroll: true }); }
  }, [selection]);
  useEffect(() => {
    if (!selection || selection.line === null || view !== "source" || content.data === undefined) return;
    const target = document.getElementById(`${fileId(file.path)}-${selection.line}`) ?? viewer.current;
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [selection, view, content.data, file.path]);
  return <section className="skill-file-viewer skill-frame" id="skill-viewer" ref={viewer} tabIndex={-1} aria-label={file.path}>
    <div className="skill-file-head">
      <div className="skill-panel-head"><h2><FileText aria-hidden="true" /><code>{file.path}</code></h2><a className="skill-files-jump" href="#skill-files">{m.filesTitle}</a></div>
      {file.kind === "text" && <div className="skill-viewer-toolbar"><Segmented aria-label={m.fileView} value={view} onValueChange={setView} className="skill-segments" options={[...(file.path === "SKILL.md" ? [{ value: "preview" as const, label: m.preview }] : []), { value: "source", label: m.rawSource }, ...(draft.kind === "replace" ? [{ value: "diff" as const, label: m.diff }] : [])]} /><code>{formatSkillFileSize(file.byteSize)}</code></div>}
    </div>
    {file.kind === "binary" ? <div className="skill-binary"><Files aria-hidden="true" /><p><code>{file.mediaType}</code><span className="skill-count">{formatSkillFileSize(file.byteSize)}</span></p><p>{m.binaryNotice}</p></div> : <>
      {content.error ? <p className="skill-file-notice" role="alert">{content.error.message}</p> : content.data == null ? <div className="skill-file-loading" role="status" aria-label={m.loading}><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-1/2" /></div> : view === "preview" ? preview ? <div className="skill-markdown"><MarkdownViewer text={preview.markdown} locale={language} chrome="none" /></div> : <Skeleton className="m-5 h-32" /> : view === "source" ? <pre className="skill-source-lines" id={fileId(file.path)}>{content.data.split("\n").map((line, index) => <span key={index} id={`${fileId(file.path)}-${index + 1}`} tabIndex={-1} data-highlighted={selection?.line === index + 1 ? "true" : undefined}><span className="skill-line-number" aria-hidden="true">{index + 1}</span>{line || " "}</span>)}</pre> : !hasCurrent ? <FileDiff current="" proposed={content.data} /> : current.error ? <p className="skill-file-notice" role="alert">{current.error.message}</p> : current.data === undefined ? <Skeleton className="m-5 h-32" /> : current.data === null ? <p className="skill-file-notice">{m.missing}</p> : <FileDiff current={current.data} proposed={content.data} />}
    </>}
  </section>;
}

function BaseFileRow({ draftId, path, change, selected, onSelect }: { readonly draftId: string; readonly path: string; readonly change: "removed" | "kept"; readonly selected: boolean; readonly onSelect: () => void }) {
  const m = useSkillDraftMessages();
  const content = useQuery(skillBaseFileQueryOptions(draftId, path));
  return <li><button type="button" aria-current={selected ? "true" : undefined} onClick={onSelect}><span className="skill-kind-tile"><FileText aria-hidden="true" /></span><span className="skill-file-facts"><code>{path}</code><span>{content.data && <code>{formatSkillFileSize(content.data.byteSize)}</code>}<span className="skill-change" data-change={change}>{m.change[change]}</span></span></span></button></li>;
}

function BaseFileViewer({ draft, path }: { readonly draft: SkillDraft; readonly path: string }) {
  const m = useSkillDraftMessages();
  const content = useQuery(skillBaseFileQueryOptions(draft.id, path));
  const removed = draft.removedPaths.includes(path);
  const [view, setView] = useState<"source" | "diff">(removed ? "diff" : "source");
  const viewer = useRef<HTMLElement>(null);
  useEffect(() => { viewer.current?.scrollIntoView({ block: "start" }); viewer.current?.focus({ preventScroll: true }); }, [path]);
  return <section ref={viewer} tabIndex={-1} id="skill-viewer" className="skill-file-viewer skill-frame" aria-label={path}>
    <div className="skill-file-head">
      <div className="skill-panel-head"><h2><FileText aria-hidden="true" /><code>{path}</code></h2><span className="skill-change" data-change={removed ? "removed" : "kept"}>{m.change[removed ? "removed" : "kept"]}</span><a className="skill-files-jump" href="#skill-files">{m.filesTitle}</a></div>
      {content.data && content.data.text !== null && <div className="skill-viewer-toolbar"><Segmented aria-label={m.fileView} value={view} onValueChange={setView} className="skill-segments" options={[{ value: "source", label: m.rawSource }, { value: "diff", label: m.diff }]} /><code>{formatSkillFileSize(content.data.byteSize)}</code></div>}
    </div>
    {content.error ? <p className="skill-file-notice" role="alert">{content.error.message}</p> : content.data === undefined ? <Skeleton className="m-5 h-32" /> : content.data === null ? <p className="skill-file-notice">{m.missing}</p> : content.data.text === null ? <div className="skill-binary"><Files aria-hidden="true" /><p><code>application/octet-stream</code> <span className="skill-count">{formatSkillFileSize(content.data.byteSize)}</span></p><p>{m.binaryNotice}</p></div> : <>
      {view === "diff" ? <FileDiff current={content.data.text} proposed={removed ? "" : content.data.text} /> : <pre className="skill-source-lines">{content.data.text.split("\n").map((line, index) => <span key={index}><span className="skill-line-number" aria-hidden="true">{index + 1}</span>{line || " "}</span>)}</pre>}
    </>}
  </section>;
}

function FileDiff({ current, proposed }: { readonly current: string; readonly proposed: string }) {
  const m = useSkillDraftMessages();
  const diff = lineDiff(current, proposed);
  if (diff === null) return <div className="skill-diff-fallback"><p>{m.large}</p><h3>{m.current}</h3><pre>{current}</pre><h3>{m.proposed}</h3><pre>{proposed}</pre></div>;
  const marks = { add: "+", remove: "−", same: " " };
  let before = 0;
  let after = 0;
  return <pre className="skill-diff-lines">{diff.map((line, index) => {
    if (line.kind !== "add") before++;
    if (line.kind !== "remove") after++;
    return <span key={index} data-change={line.kind}><span className="skill-line-number" aria-hidden="true">{line.kind === "add" ? "" : before}</span><span className="skill-line-number" aria-hidden="true">{line.kind === "remove" ? "" : after}</span><span className="skill-diff-mark">{marks[line.kind]}</span>{line.text || " "}</span>;
  })}</pre>;
}
