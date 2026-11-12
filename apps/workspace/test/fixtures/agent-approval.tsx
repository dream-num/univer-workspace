import type { components } from "../../generated/http/schema";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { LanguageProvider, useI18n } from "../../web/src/shared/i18n";
import { sessionQueryKey } from "../../web/src/features/auth";
import { spaceQueryOptions } from "../../web/src/features/spaces";
import { resourceOpenQueryOptions } from "../../web/src/features/resources";
import { ApprovalCard } from "../../web/src/features/agents/ui/approval-card";
import type { ApprovalAction } from "../../web/src/features/agents/runtime/approvals";
import "../../web/src/app/styles/global.css";
import "../../web/src/modes/repository/theme.css";
import "../../web/src/features/agents/ui/agents.css";

const html = (version: string) => `<!doctype html><html><head><style>body{font:24px system-ui;background:#edf6ff;padding:40px}input{font:inherit}</style></head><body><h1>${version}</h1><label>Try this draft <input value="Local only"></label></body></html>`;
const queries = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false, refetchOnWindowFocus: false } } });
const fixtureSession: components["schemas"]["AuthenticatedSession"] = {
  authenticated: true, user: { id: "fixture-owner", username: "alice", displayName: "Fixture Owner", avatarUrl: null },
  githubOAuthEnabled: false, googleOAuthEnabled: false, discordOAuthEnabled: false, passwordAuthEnabled: true,
  emailAuthEnabled: false, trialDeployment: false, authenticationMethods: { password: true, email: null, externalIdentities: [] },
};
queries.setQueryData(sessionQueryKey, () => fixtureSession);
queries.setQueryData(spaceQueryOptions("fixture-repository").queryKey, {
  id: "fixture-repository", type: "team", name: "Sales", fullName: "alice/sales", publicRead: false,
  slug: "sales", description: "", owner: { id: "fixture-owner", username: "alice" }, affiliation: "owner", accessRole: "owner",
  capabilities: { browseRoot: true, createAtRoot: true, renameSpace: true, manageMembers: true, viewTrash: true,
    createIssue: true, triageIssues: true, manageIssueLabels: true },
});
queries.setQueryData(resourceOpenQueryOptions("fixture-page").queryKey, { resource: {
  id: "fixture-page", nodeId: "fixture-node", kind: "blob", name: "Sales page.univer.html", spaceId: "fixture-repository",
  accessRole: "owner", originalFilename: "Sales page.univer.html", mediaType: "text/html", sha256: "fixture",
  contentUrl: `data:text/html,${encodeURIComponent(html("Current published page"))}`, downloadUrl: "", byteSize: 300,
} });
const actions: Record<string, ApprovalAction> = {
  create: { kind: "create", name: "Sales page.univer.html", spaceId: "fixture-repository", html: html("New draft page") },
  replace: { kind: "replace", resourceId: "fixture-page", html: html("New replacement page"), etag: "v1" },
  upload: { kind: "create", name: "Uploaded page.univer.html", spaceId: "fixture-repository", html: null },
};
function Fixture() {
  const { setLanguage } = useI18n();
  const [variant, setVariant] = useState("create");
  const [result, setResult] = useState("");
  return <main className="agent-page" style={{ maxWidth: 900, margin: "40px auto", padding: 20 }}>
    <h1>Agent approval fixture</h1>
    <div className="agent-approval-actions">
      <button onClick={() => setLanguage("en-US")}>English</button><button onClick={() => setLanguage("zh-CN")}>中文</button>
      {Object.keys(actions).map((kind) => <button key={kind} onClick={() => { setVariant(kind); setResult(""); }}>{kind}</button>)}
    </div>
    <ApprovalCard key={variant} approval={{ approvalId: variant, toolCallId: variant, toolName: variant === "replace" ? "html_view_replace" : "html_view_create", action: actions[variant]! }}
      disabled={false} onDecide={(approved) => setResult(approved ? "approved" : "rejected")} />
    <output aria-label="Decision">{result}</output>
  </main>;
}
const router = createRouter({ routeTree: createRootRoute({ component: Fixture }), history: createMemoryHistory({ initialEntries: ["/"] }) });
createRoot(document.getElementById("root")!).render(<LanguageProvider><QueryClientProvider client={queries}><RouterProvider router={router} /></QueryClientProvider></LanguageProvider>);
