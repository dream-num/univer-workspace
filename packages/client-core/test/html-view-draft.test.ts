import { expect, it } from "vitest";
import { parseHtmlViewDraft, readWorkspaceHtmlViewDraft } from "../src/html-view-draft.js";
import { WorkspaceHttp } from "../src/http.js";

const origin = "https://workspace.test";
const pending = { id: "draft", kind: "create", state: "pending", name: "Page.univer.html",
  spaceId: "space", targetResourceId: null, published: null, expiresAt: "later" };

it.each([
  { sourceWorktreeId: null, publishWhen: "publish" },
  { sourceWorktreeId: "source", publishWhen: "merge" },
  { sourceWorktreeId: "source", publishWhen: "publish" },
])("preserves the server publication hint $publishWhen with source $sourceWorktreeId", async (fields) => {
  const http = new WorkspaceHttp({ origin, role: "client", cookie: "session=test",
    fetcher: async () => Response.json({ draft: { ...pending, ...fields } }) });
  expect(await readWorkspaceHtmlViewDraft(async () => http, origin, "draft")).toMatchObject(fields);
});

it("keeps the publication hint absent when the server omits it", () => {
  for (const draft of [pending, { ...pending, state: "superseded", supersededBy: "next" },
    { ...pending, state: "published", published: { nodeId: "node", resourceId: "resource", etag: '\"v1\"' } }]) {
    expect(parseHtmlViewDraft(draft, origin)).not.toHaveProperty("publishWhen");
  }
});

it.each([null, "ready", 1, { state: "merge" }])("rejects malformed publication hints %j", (publishWhen) => {
  expect(() => parseHtmlViewDraft({ ...pending, publishWhen }, origin)).toThrow("invalid HTML View draft");
});
