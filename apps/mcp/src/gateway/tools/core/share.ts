import { formatShare, parseNodeReference, SHARE_LINKS, shareNode } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { spaceFeature } from "./pr-support.js";

const inputSchema = z.object({
  node: z
    .string()
    .describe("The file: its link (<Workspace>/nodes/<nodeId>) or its Node ID, the nodeId in tool results."),
  link: z
    .enum(SHARE_LINKS)
    .optional()
    .describe(
      "viewer: anyone with the link can read. editor: signed-in people can also edit. off: stop sharing. Omit to read the current setting without changing it.",
    ),
});
export const shareOutputSchema = z.object({
  url: z.url(),
  name: z.string(),
  link: z.enum(SHARE_LINKS),
  owner: z.object({
    username: z.string(),
    kind: z.enum(["human", "agent"]),
    claimed: z.boolean().optional(),
  }),
  expiresAt: z.string().optional(),
  access: z.string().optional(),
});
export const shareTool: ToolDefinition = {
  name: "share",
  toolset: "core",
  principals: ["human", "agent_claimed"],
  scope: "publish",
  title: "Share a file by link",
  description:
    "Read or set Link Sharing for a file in a Personal Space. A shared file is a drop: anyone who has the returned url can open it without signing in. Share a file after its pull request is merged, and only its owner can share it. To read a drop, pass its url as unit with trunk: true to read, find, inspect, outline or screenshot. Through an editor link, anonymous visitors and unclaimed agents still only read. expiresAt is set when the drop stops working on that date unless its owner, an unclaimed agent, stays active.",
  inputSchema,
  outputSchema: shareOutputSchema,
  annotations: writeAnnotations,
  async run(context, args) {
    const { node, link } = inputSchema.parse(args);
    const nodeId = parseNodeReference(node, context.identityOrigin);
    const shared = await shareNode(spaceFeature(context), context.identityOrigin, {
      node: nodeId,
      ...(link === undefined ? {} : { link }),
      caller: context.user,
      // A person reaches the gateway with a token session, which cannot change Link Sharing.
      ...(context.user.kind === "agent" ? { turnOn: `call share with node ${nodeId} and link viewer` } : {}),
    });
    return {
      output: shared,
      text: formatShare(shared),
      repo: null,
      nodeId,
    };
  },
};
