import { IDEMPOTENCY_KEY_DESCRIPTION } from "../schemas.js";
import { htmlViewSourceSchema, readHtmlView, htmlViewPullRequestShape, htmlViewWorktree } from "./html-view-support.js";
import { opSpecs } from "../../../shared/executor-protocol.js";
import { writeAnnotations } from "../definition.js";
import { executorTool } from "../executor-tool.js";
import { repoInput, resolveRepo } from "../core/issue-support.js";

export const htmlViewCreateTool = executorTool({
  name: "html_view_create",
  toolset: "core",
  scope: "write",
  title: "Draft an HTML View",
  description:
    "Create a shareable live page (HTML View, .univer.html) on Workspace Sheet data and save it as a draft. Use it whenever the user wants a page, dashboard, report or HTML to share or present data that is in Workspace. Prefer it over writing a local .html file unless the user asks for a file. Read the html-view-creator Skill first. Do not wait for the user to approve a plan or pick a style: use the style they named; otherwise pick the catalog style that fits the request and the data, and if none fits, use night-gauge or define a custom style that meets the design floor. Then draft. The call validates the HTML against the live Sheets and returns bindings, bindingCount and truncated when applicable alongside draft; if the samples do not match what you expect, fix the HTML and call again with a new key. For a Sheet still in a pull request, pass repo and pr: the preview shows that pull request's data and the page goes live when the user merges it in Workspace. Otherwise the user opens draft.previewUrl and presses Publish. Give the user draft.previewUrl and end your turn. Check html_view_draft_get before calling the page live or sharing shareUrl. Generate an idempotency_key and reuse it with identical HTML and destination on retry, including result-unknown. Provide exactly one of html or html_upload_id (a ready html-view upload). HTML is limited to 512 KiB of UTF-8 text; .univer.html is appended to name if missing.",
  annotations: writeAnnotations,
  inputSchema: htmlViewSourceSchema.safeExtend({
    ...htmlViewPullRequestShape,
    space: repoInput,
    name: opSpecs["htmlView.draft"].input.options[0].shape.name,
    parent: opSpecs["htmlView.draft"].input.options[0].shape.parentNodeId,
    idempotency_key: opSpecs["htmlView.draft"].input.options[0].shape.idempotencyKey.describe(IDEMPOTENCY_KEY_DESCRIPTION),
  }),
  op: opSpecs["htmlView.draft"],
  request: async (args, context) => ({
    input: {
      kind: "create" as const,
      ...await htmlViewWorktree(args, context),
      html: await readHtmlView(args, context),
      name: args.name,
      spaceId: await resolveRepo(context, args.space),
      idempotencyKey: args.idempotency_key,
      ...(args.parent === undefined ? {} : { parentNodeId: args.parent }),
    },
  }),
  response: (result, args, context) => {
    if (args.html !== undefined)
      context.usage?.addTransfer("upload_bytes", Buffer.byteLength(args.html, "utf8"));
    return { output: result.output };
  },
});
