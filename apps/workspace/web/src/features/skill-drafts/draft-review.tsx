import { useState } from "react";
import { MarkdownViewer } from "@univerjs/univer-workspace-markdown-viewer";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { Button } from "../../shared/ui/button";
import { spaceQueryOptions } from "../spaces/spaces.queries";
import {
  skillContentQueryOptions,
  skillDraftQueryOptions,
  skillPreviewQueryOptions,
  useSkillDraftDecision,
} from "./draft-queries";
import { useSkillDraftMessages } from "./messages";
import {
  compatibilityHeadline,
  draftProvenance,
  groupFindings,
  lineDiff,
  type skillPreview,
  type SkillDraft,
} from "./review-model";

function fileId(path: string) {
  return `skill-file-${encodeURIComponent(path)}`;
}

function revealFinding(path: string, line: number | null) {
  const file = document.getElementById(fileId(path));
  if (!(file instanceof HTMLDetailsElement)) return;
  file.open = true;
  const source = file.querySelector("details");
  if (source) source.open = true;
  const target =
    line === null ? file : (document.getElementById(`${fileId(path)}-${line}`) ?? file);
  target.scrollIntoView({ block: "center" });
  target.focus({ preventScroll: true });
}

export function SkillDraftReview({ draftId }: { readonly draftId: string }) {
  const m = useSkillDraftMessages();
  const draft = useQuery(skillDraftQueryOptions(draftId));
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8">
        {draft.isError ? (
          <p role="alert">
            {draft.error instanceof ApiError && draft.error.code === "NOT_FOUND"
              ? m.notFound
              : draft.error.message}
          </p>
        ) : !draft.data ? (
          <p role="status">{m.loading}</p>
        ) : (
          <Review key={draftId} draft={draft.data} />
        )}
      </div>
    </main>
  );
}

function Review({ draft }: { readonly draft: SkillDraft }) {
  const m = useSkillDraftMessages();
  const { language } = useI18n();
  const destination = useQuery(spaceQueryOptions(draft.spaceId));
  const decision = useSkillDraftDecision(draft.id);
  const skillContent = useQuery({
    ...skillContentQueryOptions(draft.id, "SKILL.md", "draft"),
    enabled: draft.state === "pending",
  });
  const preview = useQuery(skillPreviewQueryOptions(
    draft.id,
    draft.name,
    draft.state === "pending" ? skillContent.data ?? undefined : undefined,
  ));
  const groups = groupFindings(draft);
  const source = draftProvenance(draft.source);
  const blocked = groups.block.length > 0 || draft.compatibility === "blocked";
  return (
    <>
      <header className="space-y-4 border-b border-border pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">
              {m.title} · {m[draft.state]}
            </p>
            <h1 className="break-all text-2xl font-semibold">{draft.name}</h1>
            {preview.data?.description && (
              <p className="mt-2 text-sm text-muted-foreground">{preview.data.description}</p>
            )}
          </div>
          {draft.state === "pending" && (
            <div className="flex gap-2">
              <Button
                disabled={blocked || decision.isPending}
                aria-describedby={blocked ? "skill-publish-blocked" : undefined}
                onClick={() => decision.mutate("publish")}
              >
                {m.publish}
              </Button>
              <Button
                variant="secondary"
                disabled={decision.isPending}
                onClick={() => decision.mutate("reject")}
              >
                {m.reject}
              </Button>
            </div>
          )}
        </div>
        <h2 className="text-lg font-medium">{compatibilityHeadline(draft, language)}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt>{m.destination}</dt>
          <dd className="min-w-0 break-all">
            {destination.data?.fullName ?? destination.data?.name ?? draft.spaceId} /
            .agents/skills/{draft.name}/
          </dd>
          <dt>{m.source}</dt>
          <dd className="min-w-0 break-all">{source ? <>
            {source.href ? <a className="text-primary underline" href={source.href} target="_blank" rel="noreferrer">{m.sourceHub[source.hub]}</a> : m.sourceHub[source.hub]}
            <span className="ml-2 text-muted-foreground">{source.detail}</span>
          </> : m.agent}</dd>
        </dl>
        {destination.data?.type === "team" && <p className="text-sm">{m.memberNotice}</p>}
        {destination.error && <p role="alert">{destination.error.message}</p>}
        {preview.error && <p role="alert">{preview.error.message}</p>}
        {draft.state === "pending" && (
          <p className="text-sm text-muted-foreground">{m.publishNotice}</p>
        )}
        {draft.state === "pending" && blocked && (
          <p id="skill-publish-blocked" className="text-destructive">
            {m.blocked}
          </p>
        )}
        {draft.state !== "pending" && <p role="status">{m[draft.state]}</p>}
        {draft.state === "published" && draft.published && (
          <a
            className="text-primary underline"
            href={`/nodes/${encodeURIComponent(draft.published.folderNodeId)}`}
          >
            {m.openFolder}
          </a>
        )}
        {decision.error && (
          <p role="alert" className="text-destructive">
            {decision.error.message}
          </p>
        )}
      </header>
      {draft.state === "pending" && (
        <>
          <section aria-label={m.findings} className="space-y-4">
            {(["block", "warn", "info"] as const).map(
              (severity) =>
                groups[severity].length > 0 && (
                  <div key={severity}>
                    <h2 className="font-semibold">
                      {m[severity]} ({groups[severity].length})
                    </h2>
                    <ul className="mt-2 space-y-3">
                      {groups[severity].map((finding, index) => (
                        <li key={index} className="rounded-md border border-border p-3 text-sm">
                          <a
                            className="text-primary underline"
                            href={`#${fileId(finding.path)}`}
                            onClick={(event) => {
                              event.preventDefault();
                              revealFinding(finding.path, finding.line);
                            }}
                          >
                            {finding.path}
                            {finding.line !== null ? `:${finding.line}` : ""}
                          </a>
                          <span className="ml-2 text-muted-foreground">{finding.rule}</span>
                          {"message" in finding ? (
                            <p className="mt-1">{finding.message}</p>
                          ) : (
                            <>
                              <blockquote className="my-2 border-l-2 border-border pl-3 whitespace-pre-wrap">
                                {finding.quote}
                              </blockquote>
                              <p>{finding.impact}</p>
                              <p className="mt-1">{finding.suggestion}</p>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
            )}
            {draft.unverifiedReviewCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {draft.unverifiedReviewCount} {m.unverified} · {m.unverifiedNotice}
              </p>
            )}
          </section>
          {draft.removedPaths.length > 0 && (
            <section>
              <h2 className="font-semibold">{m.removed}</h2>
              <ul className="mt-2 list-inside list-disc text-sm">
                {draft.removedPaths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </section>
          )}
          {draft.keep.length > 0 && (
            <section>
              <h2 className="font-semibold">{m.kept}</h2>
              <ul className="mt-2 list-inside list-disc text-sm">
                {draft.keep.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </section>
          )}
          <section className="space-y-4" aria-label={m.proposed}>
            {draft.files.map((file) =>
              file.kind === "binary" ? (
                <div key={file.path} className="rounded-lg border border-border p-4 text-sm">
                  {file.path} · {file.byteSize} B · {file.mediaType}
                </div>
              ) : (
                <DraftFile key={file.path} draft={draft} file={file} preview={preview.data} />
              ),
            )}
          </section>
        </>
      )}
    </>
  );
}

function DraftFile({
  draft,
  file,
  preview,
}: {
  readonly draft: SkillDraft;
  readonly file: SkillDraft["files"][number];
  readonly preview: Awaited<ReturnType<typeof skillPreview>> | undefined;
}) {
  const m = useSkillDraftMessages();
  const { language } = useI18n();
  const content = useQuery(skillContentQueryOptions(draft.id, file.path, "draft"));
  const [source, setSource] = useState(false);
  const hasCurrent = draft.base?.some((base) => base.path === file.path) ?? false;
  const current = useQuery({
    ...skillContentQueryOptions(draft.id, file.path, "current"),
    enabled: hasCurrent,
  });
  return (
    <details
      id={fileId(file.path)}
      open={file.path === "SKILL.md"}
      tabIndex={-1}
      className="rounded-lg border border-border"
    >
      <summary className="cursor-pointer break-all px-4 py-3 font-medium">
        {file.path}{" "}
        <span className="text-xs text-muted-foreground">
          {file.byteSize} B · {file.mediaType}
        </span>
      </summary>
      <div className="space-y-4 border-t border-border p-4">
        {content.error ? (
          <p role="alert">{content.error.message}</p>
        ) : content.data == null ? (
          <p role="status">{m.loading}</p>
        ) : (
          <>
            {file.path === "SKILL.md" && (
              <>
                <div className="flex gap-2" role="group" aria-label="Markdown">
                  <Button variant="secondary" className="aria-pressed:bg-accent aria-pressed:text-accent-foreground" aria-pressed={!source} onClick={() => setSource(false)}>
                    {m.preview}
                  </Button>
                  <Button variant="secondary" className="aria-pressed:bg-accent aria-pressed:text-accent-foreground" aria-pressed={source} onClick={() => setSource(true)}>
                    {m.rawSource}
                  </Button>
                </div>
                {source ? (
                  <pre className="overflow-x-auto text-xs leading-6">{content.data}</pre>
                ) : preview ? (
                  <MarkdownViewer text={preview.markdown} locale={language} chrome="none" />
                ) : (
                  <p role="status">{m.loading}</p>
                )}
              </>
            )}
            <details open={file.path !== "SKILL.md"}>
              <summary className="cursor-pointer text-sm">{m.sourceLines}</summary>
              <pre className="mt-2 overflow-x-auto text-xs leading-6">
                {content.data.split("\n").map((line, index) => (
                  <span
                    key={index}
                    id={`${fileId(file.path)}-${index + 1}`}
                    tabIndex={-1}
                    className="block min-w-fit focus:bg-accent"
                  >
                    <span className="mr-4 inline-block w-8 select-none text-right text-muted-foreground">
                      {index + 1}
                    </span>
                    {line || " "}
                  </span>
                ))}
              </pre>
            </details>
            {draft.kind === "replace" && (
              <section aria-label={`${file.path} ${m.diff}`}>
                <h3 className="mb-2 text-sm font-semibold">{m.diff}</h3>
                {!hasCurrent ? (
                  <FileDiff current="" proposed={content.data} />
                ) : current.error ? (
                  <p role="alert">{current.error.message}</p>
                ) : current.data === undefined ? (
                  <p>{m.loading}</p>
                ) : current.data === null ? (
                  <p>{m.missing}</p>
                ) : (
                  <FileDiff current={current.data} proposed={content.data} />
                )}
              </section>
            )}
          </>
        )}
      </div>
    </details>
  );
}

function FileDiff({ current, proposed }: { readonly current: string; readonly proposed: string }) {
  const m = useSkillDraftMessages();
  const diff = lineDiff(current, proposed);
  if (diff === null)
    return (
      <>
        <p className="text-sm text-muted-foreground">{m.large}</p>
        <h4>{m.current}</h4>
        <pre className="overflow-auto text-xs">{current}</pre>
        <h4>{m.proposed}</h4>
        <pre className="overflow-auto text-xs">{proposed}</pre>
      </>
    );
  return (
    <pre className="overflow-x-auto text-xs leading-6">
      {diff.map((line, index) => (
        <span
          key={index}
          className={`block min-w-fit ${line.kind === "add" ? "bg-green-500/10" : line.kind === "remove" ? "bg-red-500/10" : ""}`}
        >
          {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "} {line.text}
        </span>
      ))}
    </pre>
  );
}
