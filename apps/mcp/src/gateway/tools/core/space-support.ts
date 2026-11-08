import {
  nodeUrl,
  pullSpaceId,
  pullUrl,
  WorkspaceUnitFeature,
  type WorkspaceUnit,
  type WorkspaceWorktree,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { ToolContext } from "../definition.js";
import { spaceFeature, worktreeFeature } from "./pr-support.js";

export const worktreeInput = z
  .string()
  .describe("Worktree ID: the id of a pull request, as returned by pr_create or pr_view.");
export const resourceKindInput = z
  .enum(["none", "univer", "blob"])
  .describe("none: organizing folders only; univer: documents; blob: uploaded files.");
export const unitTypeInput = z
  .enum(["sheet", "base", "doc", "slide", "board"])
  .describe("Only with resource_kind univer.");
export const nodeIdInput = (what: string) => z.string().describe(`Node ID of ${what}.`);

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
