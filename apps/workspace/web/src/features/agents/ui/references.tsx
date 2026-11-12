import type { UIMessage } from "ai";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleDot, GitPullRequest, BookMarked, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { DEFAULT_ISSUE_FILTERS, issueListQueryOptions } from "../../issues/issues.queries";
import { mySpacesQueryOptions, spaceQueryOptions } from "../../spaces/spaces.queries";
import { spaceSupportsIssues } from "../../spaces/space.rules";
import { worktreePagesQueryOptions } from "../../worktrees/worktrees.queries";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { SearchSelect } from "../../../shared/ui/combobox";
import { agentReferenceKey, agentReferenceSchema } from "../agent.types";
import type { AgentReference } from "../agent.types";
import { useAgentMessages } from "./messages";

const referenceMetadataSchema = z.object({ agentReferences: z.array(agentReferenceSchema) });
export function messageReferences(metadata: UIMessage["metadata"]): AgentReference[] {
  const parsed = referenceMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data.agentReferences : [];
}
export function referenceTrigger(text: string, caret: number): number | null {
  return (text[caret - 1] === "@" || text[caret - 1] === "＠") && !/[A-Za-z0-9_.+-]/.test(text[caret - 2] ?? "") ? caret - 1 : null;
}
export function addReference(references: AgentReference[], reference: AgentReference): AgentReference[] {
  return references.some((item) => agentReferenceKey(item) === agentReferenceKey(reference)) ? references : [...references, reference];
}
function ReferenceLabel({ reference }: { readonly reference: AgentReference }) {
  const m = useAgentMessages();
  const Icon = { space: BookMarked, issue: CircleDot, pr: GitPullRequest }[reference.kind];
  return <><Icon aria-hidden="true" /><span>{reference.kind === "space" ? reference.label : `#${reference.number} ${reference.label}`}</span><span className="sr-only">{reference.kind === "space" ? m.repository : reference.kind === "issue" ? m.issues : m.prs}</span></>;
}
export function AgentReferenceChips({ references, onRemove, disabled }: {
  readonly references: AgentReference[]; readonly onRemove?: (reference: AgentReference) => void; readonly disabled?: boolean;
}) {
  const m = useAgentMessages();
  if (!references.length) return null;
  return <ul className="agent-references" aria-label={m.context}>{references.map((reference) => <li key={agentReferenceKey(reference)} className="agent-reference">
    {onRemove ? <><ReferenceLabel reference={reference} /><Button variant="ghost" size="icon" aria-label={m.removeContext(reference.label)} disabled={disabled} onClick={() => onRemove(reference)}><X aria-hidden="true" /></Button></>
      : reference.kind === "space" ? <Link to="/spaces/$spaceId" params={{ spaceId: reference.spaceId }}><ReferenceLabel reference={reference} /></Link>
        : reference.kind === "issue" ? <Link to="/spaces/$spaceId/issues/$number" params={{ spaceId: reference.spaceId, number: String(reference.number) }} search={{}}><ReferenceLabel reference={reference} /></Link>
          : <Link to="/spaces/$spaceId/pulls/$number" params={{ spaceId: reference.spaceId, number: String(reference.number) }} search={{}}><ReferenceLabel reference={reference} /></Link>}
  </li>)}</ul>;
}
export function AgentReferencePicker({ spaceId, onChoose, onClose }: {
  readonly spaceId?: string | undefined; readonly onChoose: (reference: AgentReference) => void; readonly onClose: () => void;
}) {
  const m = useAgentMessages();
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const spaces = useQuery(mySpacesQueryOptions);
  const space = useQuery(spaceQueryOptions(spaceId));
  const issues = useInfiniteQuery({ ...issueListQueryOptions(spaceId, { ...DEFAULT_ISSUE_FILTERS, q: search }), enabled: !spaceId || Boolean(space.data && spaceSupportsIssues(space.data)) });
  const pulls = useInfiniteQuery({ ...worktreePagesQueryOptions({ q: search, ...(spaceId ? space.data?.type === "team" ? { teamSpaceId: spaceId } : { kind: "user" as const } : {}) }), enabled: !spaceId || Boolean(space.data) });
  const personalSpaces = new Map((spaces.data?.spaces ?? []).filter((item) => item.type === "personal").map((item) => [item.owner.id, item.id]));
  const query = search.trim().toLocaleLowerCase();
  const repositories: AgentReference[] = (spaces.data?.spaces ?? []).map((item) => ({ kind: "space", spaceId: item.id, label: item.fullName ?? item.name }));
  const issueReferences: AgentReference[] = (issues.data?.pages[0]?.items ?? []).map((item) => ({ kind: "issue", spaceId: item.space.id, number: item.number, label: item.title }));
  const pullReferences: AgentReference[] = (pulls.data?.pages[0]?.items ?? []).filter((item) => item.state === "draft" || item.state === "ready").flatMap((item) => {
    const repo = item.kind === "team" ? item.teamSpace?.id : personalSpaces.get(item.creator.id);
    return repo && item.number !== null ? [{ kind: "pr" as const, spaceId: repo, number: item.number, label: item.name }] : [];
  });
  const items = [...repositories.filter((item) => item.label.toLocaleLowerCase().includes(query)), ...issueReferences, ...pullReferences].filter((item) => agentReferenceSchema.safeParse(item).success);
  const groups = { space: m.repositories, issue: m.issues, pr: m.prs };
  const errors = [spaces.error, space.error, issues.error, pulls.error].filter((error) => error !== null);
  // shortcut: SearchSelect has no open prop; replace the input event when it exposes one.
  useEffect(() => { const input = root.current?.querySelector("input"); input?.focus(); input?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); }, []);
  return <div ref={root} className="agent-reference-picker" onKeyDownCapture={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="agent-reference-picker-header"><span>{m.addContext}</span><Button variant="ghost" size="icon" aria-label={m.close} onClick={onClose}><X aria-hidden="true" /></Button></div>
    <SearchSelect items={items} value={null} onValueChange={(reference) => { if (reference) onChoose(reference); }}
      onInputValueChange={(value, reason) => { if (reason === "input-change") setSearch(value.slice(0, 200)); }}
      itemKey={agentReferenceKey} itemToStringLabel={(reference) => reference.label} placeholder={m.searchContext} aria-label={m.searchContext}
      emptyContent={spaces.isLoading || issues.isLoading || pulls.isLoading ? m.loading : m.noContext}
      renderItem={(reference) => <span className="agent-reference-choice">{items.find((item) => item.kind === reference.kind) === reference ? <span className="agent-reference-group">{groups[reference.kind]}</span> : null}<span className="agent-reference-choice-label"><ReferenceLabel reference={reference} /></span>{reference.kind !== "space" ? <span className="agent-reference-repository">{spaces.data?.spaces.find((item) => item.id === reference.spaceId)?.fullName ?? reference.spaceId}</span> : null}</span>} />
    {errors.map((error, index) => <Alert key={index} variant="destructive">{error.message}</Alert>)}
  </div>;
}
