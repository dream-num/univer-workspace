import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FileText } from "lucide-react";
import { useI18n } from "../../shared/i18n";
import { Skeleton } from "../../shared/ui";
import { skillDraftQueryOptions } from "./draft-queries";
import { SkillDraftState } from "./draft-review";
import { useSkillDraftMessages } from "./messages";
import { compatibilityHeadline } from "./review-model";
import { compatibilityStates } from "./review-presentation";

export function SkillDraftCard({ draftId }: { readonly draftId: string }) {
  const m = useSkillDraftMessages();
  const { language } = useI18n();
  const draft = useQuery(skillDraftQueryOptions(draftId));
  const href = `/drafts/skills/${encodeURIComponent(draftId)}`;
  if (!draft.data) return <div className="skill-draft-card">{draft.error ? <p role="alert">{draft.error.message} <a href={href}>{m.reviewDraft}</a></p> : <Skeleton className="h-20 w-full" aria-label={m.loading} />}</div>;
  const verdict = compatibilityStates[draft.data.compatibility];
  return <article className="skill-draft-card" aria-label={m.title}>
    <div className="skill-draft-card-head"><FileText aria-hidden="true" /><strong>{draft.data.name}</strong><SkillDraftState state={draft.data.state} /></div>
    <p className="skill-draft-card-verdict" data-tone={verdict.tone}><verdict.icon aria-hidden="true" />{compatibilityHeadline(draft.data, language)}</p>
    <div className="skill-draft-card-footer"><span><code>{draft.data.files.length}</code> {m.files(draft.data.files.length)}</span><a href={href} target="_blank" rel="noreferrer">{m.reviewDraft}<ArrowUpRight aria-hidden="true" /></a></div>
  </article>;
}
