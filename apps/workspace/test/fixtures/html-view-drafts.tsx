import type { UIMessage } from "ai";
import { sessionRecordSchema } from "../../web/src/features/agents/agent.types";
import type { components } from "../../generated/http/schema";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import "../../web/src/app/styles/global.css";
import "../../web/src/features/agents/ui/agents.css";

const scenario = new URLSearchParams(location.search).get("draft") ?? "create";
const state = scenario === "conflicted" || scenario === "expired" || scenario === "rejected" || scenario === "published" ? scenario : "pending";
let draft: components["schemas"]["HtmlViewDraft"] = {
  id: scenario, kind: scenario === "replace" ? "replace" : "create", state,
  name: "Sales page.univer.html", spaceId: "sales", parentNodeId: "reports", targetResourceId: scenario === "replace" ? "old-page" : null,
  baseEtag: scenario === "replace" ? '"v1"' : null, byteSize: 200, createdAt: "2026-11-12T00:00:00Z", expiresAt: "2026-11-19T00:00:00Z",
  decidedAt: null, published: state === "published" ? { nodeId: "published-page", resourceId: "page", etag: '"v2"' } : null,
};
const page = (title: string) => `<!doctype html><html><head><style>body{margin:0;padding:48px;background:#edf6ff;color:#173a5b;font:20px system-ui}h1{font-size:40px}input{padding:10px;font:inherit}</style></head><body><h1>${title}</h1><p>Review this page before publishing.</p><label>Local preview <input value="Not saved"></label></body></html>`;
const session: components["schemas"]["AuthenticatedSession"] = {
  authenticated: true, user: { id: "fixture-owner", username: "alice", displayName: "Fixture Owner", avatarUrl: null },
  githubOAuthEnabled: false, googleOAuthEnabled: false, discordOAuthEnabled: false, passwordAuthEnabled: true,
  emailAuthEnabled: false, trialDeployment: false, authenticationMethods: { password: true, email: null, externalIdentities: [] },
};
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(new URL(String(input), location.origin), init);
  const path = new URL(request.url).pathname;
  if (path === "/api/session") return Response.json(session);
  if (path === "/current.html") return new Response(page("Current published page"));
  if (path.endsWith("/content")) return new Response(page("New draft page"));
  if (path.endsWith("/publish")) draft = { ...draft, state: "published", published: { nodeId: "published-page", resourceId: "page", etag: '"v2"' } };
  if (path.endsWith("/reject")) draft = { ...draft, state: "rejected" };
  if (path.startsWith("/api/html-view-drafts/")) return scenario === "missing" ? Response.json({ error: { code: "NOT_FOUND", message: "Draft not found." } }, { status: 404 }) : Response.json({ draft });
  if (path === "/api/spaces/sales") return Response.json({ fullName: "alice/sales", publicRead: false });
  if (path === "/api/nodes/reports") return Response.json({ node: { name: "Reports" } });
  if (path === "/api/resources/old-page/open") return Response.json({ resource: { kind: "blob", contentUrl: "/current.html", byteSize: 200 } });
  throw new Error(`Unexpected fixture request ${request.method} ${path}`);
};
const [{ Providers, queryClient }, { routeTree }] = await Promise.all([
  import("../../web/src/app/providers"), import("../../web/src/routeTree.gen"),
]);
queryClient.setQueryData(["session"], session);
const router = createRouter({ routeTree, context: { queryClient }, history: createMemoryHistory({ initialEntries: [`/drafts/${scenario}`] }) });
const root = document.getElementById("root");
if (!root) throw new Error("Fixture root is missing");
if (new URLSearchParams(location.search).has("agent")) {
  const { AgentStepsGroup } = await import("../../web/src/features/agents/ui/session-page");
  const message: UIMessage = { id: "assistant", role: "assistant", parts: [{
    type: "dynamic-tool", toolName: draft.kind === "replace" ? "html_view_replace" : "html_view_create", toolCallId: "page",
    state: "output-available", input: { name: draft.name }, output: { content: [], structuredContent: { draft: { id: draft.id } } },
  }] };
  const agent = { ...sessionRecordSchema.parse({
    id: "fixture-agent", userId: "fixture-owner", scope: { kind: "global" }, mode: "auto", status: "idle",
    model: { providerId: "fixture", modelId: "fixture", thinking: null }, messages: [], worktreeIds: [],
    createdAt: "2026-11-12T00:00:00Z", updatedAt: "2026-11-12T00:00:00Z", error: null,
  }), messages: [message] };
  const agentRoute = createRootRoute({ component: () => <main className="agent-page" style={{ maxWidth: 900, margin: "40px auto", padding: 20 }}>
    <AgentStepsGroup parts={message.parts.filter((part) => "toolCallId" in part)} session={agent} />
  </main> });
  const agentRouter = createRouter({ routeTree: agentRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
  createRoot(root).render(<Providers><RouterProvider router={agentRouter} /></Providers>);
} else createRoot(root).render(<Providers><RouterProvider router={router} /></Providers>);
