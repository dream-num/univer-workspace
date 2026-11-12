import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChartNoAxesCombined, FileCode, Sheet } from "lucide-react";
import { spaceQueryOptions, mySpacesQueryOptions } from "../../spaces/spaces.queries";
import { worktreeQueryOptions } from "../../worktrees/worktrees.queries";
import type { AgentPageHost } from "./host";
import { useI18n, type MessageKey } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/alert";
import { Badge } from "../../../shared/ui/badge";
import { sessionTitle } from "../agent.types";
import type { AgentSession, AgentSessionStatus } from "../agent.types";
import { useAgentClient } from "./client";
import { AgentComposer } from "./composer";
import { useAgentMessages } from "./messages";
import { newestSessions } from "./summaries";

export function useAgentSessions() {
  const client = useAgentClient();
  const queryClient = useQueryClient();
  const queryKey = ["agent-sessions", client.userId];
  const query = useQuery({ queryKey, queryFn: () => client.sessions.list(), refetchInterval: 2000 });
  useEffect(() => client.sessions.subscribe((session) => {
    queryClient.setQueryData<AgentSession[]>(["agent-sessions", client.userId], (previous) => [session, ...(previous ?? []).filter((item) => item.id !== session.id)]);
  }), [client, queryClient]);
  return query;
}
export function HomeAgents() {
  const m = useAgentMessages();
  const sessions = useAgentSessions();
  const location = useLocation();
  const recent = newestSessions(sessions.data ?? []).slice(0, 5);
  return <div className="agent-home">
    <AgentComposer focus={location.hash === "agent-composer"} />
    {sessions.error ? <Alert variant="destructive">{sessions.error.message}</Alert> : null}
    {recent.length ? <section className="agent-recent"><h2>{m.recent}</h2><ul>{recent.map((session) => <li key={session.id}>
      <Link to="/agents/$sessionId" params={{ sessionId: session.id }}>{sessionTitle(session)}</Link><SessionStatus status={session.status} />
    </li>)}</ul></section> : null}
  </div>;
}
export function AgentsPage({ spaceId, renderPage }: AgentPageHost & { readonly spaceId: string }) {
  const m = useAgentMessages();
  const sessions = useAgentSessions();
  const [starter, setStarter] = useState<{ readonly text: string } | null>(null);
  const items = newestSessions(sessions.data ?? [], spaceId);
  const starters = [
    { title: m.summarize, description: m.summarizeDescription, Icon: ChartNoAxesCombined },
    { title: m.formulas, description: m.formulasDescription, Icon: Sheet },
    { title: m.page, description: m.pageDescription, Icon: FileCode },
  ];
  return renderPage(<>
    <div className="agent-page agent-directory">
      <nav aria-label={m.agents}><a className="agent-nav-current" href="#agent-sessions" aria-current="page">{m.sessions}</a></nav>
      <div className="min-w-0">
        <AgentComposer spaceId={spaceId} starter={starter} />
        <div className="agent-starters">{starters.map(({ title, description, Icon }) => <button type="button" key={title} onClick={() => setStarter({ text: title })}>
          <Icon aria-hidden="true" /><strong>{title}</strong><span title={description}>{description}</span>
        </button>)}</div>
        <section id="agent-sessions"><h2>{m.sessions}</h2><p className="agent-note">{m.local}</p>
          {sessions.error ? <Alert variant="destructive">{sessions.error.message}</Alert> : null}
          {sessions.isPending ? <p role="status">{m.loading}</p> : !items.length ? <p>{m.empty}</p> : <div className="agent-table-scroll"><table className="agent-table">
            <thead><tr>{[m.title, m.status, m.mode, m.prs, m.model, m.started].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{items.map((session) => <SessionRow key={session.id} session={session} />)}</tbody>
          </table></div>}
        </section>
      </div>
    </div>
  </>, m.agents, spaceId);
}
function SessionRow({ session }: { readonly session: AgentSession }) {
  const m = useAgentMessages();
  const { language } = useI18n();
  return <tr>
    <td><Link className="agent-session-title" title={sessionTitle(session)} to="/agents/$sessionId" params={{ sessionId: session.id }}>{sessionTitle(session)}</Link></td>
    <td><SessionStatus status={session.status} /></td><td>{m[session.mode]}</td>
    <td>{session.worktreeIds.map((id) => <SessionPullRequest key={id} id={id} />)}</td>
    <td><SessionModel model={session.model} /></td><td><time dateTime={session.createdAt}>{new Date(session.createdAt).toLocaleString(language)}</time></td>
  </tr>;
}
export function SessionPullRequest({ id }: { readonly id: string }) {
  const m = useAgentMessages();
  const { t } = useI18n();
  const pull = useQuery({ ...worktreeQueryOptions(id), refetchInterval: 10000 });
  const spaces = useQuery(mySpacesQueryOptions);
  const worktree = pull.data?.worktree;
  if (pull.error) return <span role="alert">{pull.error.message}</span>;
  if (!worktree) return <span role="status">{m.loading}</span>;
  const spaceId = worktree.kind === "team" ? worktree.teamSpace?.id : spaces.data?.spaces.find((space) => space.type === "personal")?.id;
  const label = `#${worktree.number ?? ""} ${worktree.name} · ${m.review}`;
  return <div className="agent-pr"><Badge>{t(stateLabels[worktree.state])}</Badge>
    {spaceId && worktree.number !== null ? <Link to="/spaces/$spaceId/pulls/$number" params={{ spaceId, number: String(worktree.number) }} search={{}}>{label}</Link>
      : <Link to="/worktrees" search={{ worktree: worktree.id }}>{label}</Link>}
  </div>;
}
export function SessionScope({ session }: { readonly session: AgentSession }) {
  const m = useAgentMessages();
  const space = useQuery(spaceQueryOptions(session.scope.kind === "repository" ? session.scope.spaceId : undefined));
  return session.scope.kind === "repository" ? <Link to="/spaces/$spaceId/agents" params={{ spaceId: session.scope.spaceId }}>{space.data?.name ?? m.repository}</Link> : <span>{m.global}</span>;
}

const stateLabels = {
  draft: "worktreeStateDraft", ready: "worktreeStateReady", merging: "worktreeStateMerging",
  merged: "worktreeStateMerged", discarded: "worktreeStateDiscarded",
} satisfies Record<string, MessageKey>;

export function SessionStatus({ status }: { readonly status: AgentSessionStatus }) {
  const m = useAgentMessages();
  return <span className="agent-status" data-status={status}>{m[status]}</span>;
}
export function SessionModel({ model }: { readonly model: AgentSession["model"] }) {
  const client = useAgentClient();
  const providers = useQuery({ queryKey: ["agent-providers", client.userId], queryFn: () => client.providers.list() });
  return <span>{providers.data?.find((provider) => provider.id === model.providerId)?.label ?? model.providerId} · {model.modelId}</span>;
}
