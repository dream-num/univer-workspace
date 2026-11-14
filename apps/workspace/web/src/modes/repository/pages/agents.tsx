import { lazy, Suspense, type ReactNode } from "react";
import { loadAgentsUi } from "../../../features/agents";
import { WorkspaceLayout } from "../../workspace-layout";

const Agents = lazy(() => loadAgentsUi().then((ui) => ({ default: ui.AgentsPage })));
const Session = lazy(() => loadAgentsUi().then((ui) => ({ default: ui.AgentSessionPage })));
export const HomeAgents = lazy(() => loadAgentsUi().then((ui) => ({ default: ui.HomeAgents })));

export function RepositoryAgentsPage(props: { readonly spaceId: string; readonly prompt?: string | undefined }) {
  return <Suspense fallback={<div style={{ minHeight: 240 }} />}><Agents {...props} renderPage={renderAgentPage} /></Suspense>;
}
export function RepositoryAgentSessionPage(props: { readonly sessionId: string }) {
  return <Suspense fallback={<div style={{ minHeight: 240 }} />}><Session {...props} renderPage={renderAgentPage} /></Suspense>;
}

function renderAgentPage(content: ReactNode, title: string, spaceId?: string) {
  return <WorkspaceLayout {...(spaceId ? { selectedSpaceId: spaceId, repositoryTab: "agents" } : { repositoryView: "agents" })} headerTitle={title}>{content}</WorkspaceLayout>;
}
