import {
  isForkAddress,
  isWorkspaceRecord,
  nodeUrl,
  pullSpaceId,
  pullUrl,
  resolveUnitReference,
  WorkspaceUnitFeature,
  type BrowseSpaceInput,
  type WorkspaceUnit,
  type WorkspaceWorktree,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../definition.js";
import { forkFeature, resolveRepoOrForkInput } from "./issue-support.js";
import { spaceFeature, worktreeFeature } from "./pr-support.js";

export const worktreeInput = z
  .string()
  .refine(
    (value) => !isForkAddress(value),
    "This tool takes a Worktree ID, not a fork address. Use the worktree.id from fork_view, which a fork has after its first write.",
  )
  .describe("Worktree ID: the id of a pull request, as returned by pr_create or pr_view.");
export const worktreeOrForkInput = z
  .string()
  .describe(
    "Worktree ID: the id of a pull request, as returned by pr_create or pr_view. Or a fork address <owner>/<name> from fork_create.",
  );
export const resourceKindInput = z
  .enum(["none", "univer", "blob"])
  .describe("none: organizing folders only; univer: documents; blob: uploaded files.");
export const unitTypeInput = z
  .enum(["sheet", "base", "doc", "slide", "board"])
  .describe("Only with resource_kind univer.");
export const nodeIdInput = (what: string) => z.string().describe(`Node ID of ${what}.`);

/** Lets `unit` be a file link: resolves it to the Unit ID before the tool runs, so results and paging carry the ID. */
export function acceptUnitLink(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    async run(context, args) {
      const unit = isWorkspaceRecord(args) ? args["unit"] : undefined;
      if (typeof unit !== "string") return tool.run(context, args);
      return tool.run(context, {
        ...(args as object),
        unit: await resolveUnitReference(spaceFeature(context), unit, context.identityOrigin),
      });
    },
  };
}

/**
 * Lets `worktree` be a fork address, after `unit` is a Unit ID. A read tool reads the fork's Worktree when it holds
 * the Unit and trunk otherwise. Any other tool writes, so it always gets the fork's Worktree, which first takes the
 * upstream file and opens on the fork's first write.
 */
export function acceptForkAddress(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    async run(context, args) {
      if (!isWorkspaceRecord(args)) return tool.run(context, args);
      const { worktree, unit, ...rest } = args;
      if (typeof worktree !== "string" || !isForkAddress(worktree) || typeof unit !== "string")
        return tool.run(context, args);
      const forks = forkFeature(context);
      const scope =
        tool.scope === "read" ? await forks.readScope(worktree, unit) : await forks.writeScope(worktree, unit);
      return tool.run(
        context,
        scope.kind === "trunk" ? { ...rest, unit, trunk: true } : { ...rest, unit, worktree: scope.worktreeId },
      );
    },
  };
}

export async function resolveListing(
  context: ToolContext,
  repo: string,
): Promise<Pick<BrowseSpaceInput, "overlay" | "spaceId">> {
  const resolved = await resolveRepoOrForkInput(context, repo);
  return "fork" in resolved ? await forkFeature(context).listing(resolved.fork) : { spaceId: resolved.spaceId };
}

/** A file a fork created has no Node page until merge, so it links into the pull request. */
export function withListingUrl<Node extends { readonly nodeId: string }>(
  context: ToolContext,
  listing: Pick<BrowseSpaceInput, "overlay" | "spaceId">,
  node: Node,
): Node & { readonly url: string } {
  const worktree = listing.overlay?.worktree;
  const unit = worktree?.units.find((candidate) => candidate.source === "worktree" && candidate.nodeId === node.nodeId);
  return worktree === undefined || unit === undefined
    ? withNodeUrl(context, node)
    : { ...node, url: pullUrl(context.identityOrigin, worktree, unit.unitId, listing.spaceId) };
}

export const unitFeature = (context: ToolContext) =>
  new WorkspaceUnitFeature(async () => context.http);

export function withNodeUrl<Node extends { readonly nodeId: string }>(
  context: ToolContext,
  node: Node,
): Node & { readonly url: string } {
  return { ...node, url: nodeUrl(context.identityOrigin, node.nodeId) };
}

/** Adds the pull request page `url` to Units of an already fetched Worktree. */
export async function attachUnitUrls(
  context: ToolContext,
  worktree: WorkspaceWorktree,
  units: readonly WorkspaceUnit[],
): Promise<{
  readonly units: readonly (WorkspaceUnit & { readonly url: string })[];
  readonly spaceId: string | null;
}> {
  const spaceId = (await pullSpaceId(spaceFeature(context), worktree)) ?? null;
  return {
    spaceId,
    units: units.map((unit) => ({
      ...unit,
      url: pullUrl(context.identityOrigin, worktree, unit.unitId, spaceId ?? undefined),
    })),
  };
}

/** Adds the pull request page `url` to Units of a Worktree, resolving the Worktree once. */
export async function unitsWithUrl(
  context: ToolContext,
  worktreeId: string,
  units: readonly WorkspaceUnit[],
) {
  return await attachUnitUrls(context, await worktreeFeature(context).get(worktreeId), units);
}
