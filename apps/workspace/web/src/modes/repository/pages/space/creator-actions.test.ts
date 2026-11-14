import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ResourceActions } from "../../../../features/nodes/resource-header";
import { AppsView } from "./apps-view";
import { recent } from "../../data/fixtures.test-support";
import { LanguageProvider } from "../../../../shared/i18n";
import { UiModeProvider } from "../../../../shared/ui-mode";

vi.mock("../../../../features/editor", () => ({ CollaboratorAvatars: () => null }));
vi.mock("../../../../features/permissions", () => ({ ShareDialog: () => null }));
vi.mock("../../../../shared/resizable-sidebar", () => ({ useMediaQuery: () => false }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, params = {}, search, children, ...props }: { to: string; params?: Record<string, string>; search?: unknown; children: ReactNode }) => createElement("a", {
    ...props, href: to.replace(/\$(\w+)/g, (_, key: string) => params[key] ?? ""), "data-search": JSON.stringify(search),
  }, children),
}));
const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); });
type Resource = ComponentProps<typeof ResourceActions>["resource"];
const sheet: Resource = {
  id: "sheet-id", kind: "univer", unitId: "unit-id", unitType: "sheet", editorMode: "readOnly",
  nodeId: "sheet-node", spaceId: "alpha", name: "Revenue", accessRole: "viewer",
};
const page: Resource = {
  id: "page-id", kind: "blob", originalFilename: "Report.univer.html", mediaType: "text/html", byteSize: 100,
  downloadUrl: "/download/page", contentUrl: "/content/page", sha256: "hash",
  nodeId: "page-node", spaceId: "alpha", name: "Report.univer.html", accessRole: "viewer",
};
function render(content: ReactNode, mode: "repository" | "wiki" = "repository", authenticated = true) {
  vi.stubGlobal("window", {
    location: { origin: "https://workspace.example" },
    localStorage: { getItem: (key: string) => key === "univer-workspace-language" ? "en-US" : mode },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  client.setQueryData(["session"], { authenticated });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(LanguageProvider, null,
    createElement(UiModeProvider, { modes: ["repository", "wiki"], fallback: "repository" }, content),
  )));
}
function toolbar(resource: Resource, authenticated = true) {
  const node = { ...recent().node, name: resource.kind === "blob" ? "Report.univer.html" : "Revenue", accessRole: "viewer" as const };
  return createElement(ResourceActions, { node, resource, authenticated, currentUserId: "user", collaborators: [], htmlActionsRef: () => {} });
}
function pages() {
  return createElement(AppsView, { spaceId: "repo", apps: [], selectedApp: undefined, onSelectApp: () => {} });
}
it.each([[sheet, "Make a page", "sheet-id"], [page, "Change with Agent", "page-id"]] as const)("offers the contextual link even for a signed-in viewer of %j", (resource, label, id) => {
  const html = render(toolbar(resource));
  expect(html).toContain(label);
  expect(html).toContain('href="/spaces/alpha/agents"');
  expect(html).toContain("/html-view-creator ");
  expect(html).toContain(`(resource ${id})`);
});
it("offers new-page links beside the Pages heading and in its empty state", () => {
  const html = render(pages());
  expect(html.match(/>New page<\/a>/g)).toHaveLength(2);
  expect(html).toContain('href="/spaces/repo/agents"');
  expect(html).toContain("/html-view-creator Help me create a page bound to spreadsheet data.");
  expect(html).not.toContain("Download and install");
});
it.each(["wiki", "repository"] as const)("hides every creator entry in %s when unavailable", (mode) => {
  const authenticated = mode === "wiki";
  for (const content of [toolbar(sheet, authenticated), toolbar(page, authenticated), pages()]) {
    const html = render(content, mode, authenticated);
    expect(html).not.toContain(">Make a page</a>");
    expect(html).not.toContain(">Change with Agent</a>");
    expect(html).not.toContain(">New page</a>");
    expect(html).not.toContain('href="/spaces/alpha/agents"');
    expect(html).not.toContain('href="/spaces/repo/agents"');
  }
});
it("does not offer page creation for another Office type or an ordinary HTML blob", () => {
  for (const resource of [{ ...sheet, unitType: "doc" as const }, { ...page, originalFilename: "ordinary.html" }]) {
    expect(render(toolbar(resource))).not.toContain("/html-view-creator ");
  }
});
