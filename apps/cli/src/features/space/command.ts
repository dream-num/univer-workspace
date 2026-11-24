import { Command } from "commander";
import {
  assertSpaceFilter,
  nodeMoveParent,
  type BrowseSpaceInput,
  type WorkspaceForkFeature,
  type WorkspaceResourceKindFilter,
  type WorkspaceSpaceFeature,
  type WorkspaceUnitType,
} from "@univerjs/univer-workspace-client-core/product";
import { executeCommand, oneOf, present, type JsonOption } from "../../command.js";
import type { RepoContext } from "../../repo-context.js";

const flag = (parameter: string) => `--${parameter.replaceAll("_", "-")}`;
const LISTED_REPO = "owner/slug, unique bare slug from repo list, Space ID, URL, or a fork's owner/name";

interface BrowseOptions extends JsonOption {
  readonly parent?: string;
  readonly recursive?: boolean;
  readonly resourceKind?: string;
  readonly unitType?: string;
}

export function createSpaceCommand(
  feature: WorkspaceSpaceFeature,
  context: RepoContext,
  forks: Pick<WorkspaceForkFeature, "listing">,
): Command {
  const listing = async (reference: string): Promise<Pick<BrowseSpaceInput, "overlay" | "spaceId">> => {
    const resolved = await context.repoOrFork(reference);
    return "fork" in resolved ? await forks.listing(resolved.fork) : { spaceId: resolved.spaceId };
  };
  const space = new Command("space").description("Browse and manage the files (Nodes) of a repository; list repositories with `uvw repo list`");
  const browse = new Command("browse")
    .description("Browse a Space Node directory; a fork lists its upstream with the fork's changes")
    .argument("<repo>", LISTED_REPO)
    .option("--parent <node>", "parent Node ID")
    .option("--recursive", "browse descendants recursively")
    .option("--resource-kind <kind>", "none, univer, or blob")
    .option("--unit-type <type>", "sheet, base, doc, slide, or board")
    .option("--json", "write structured JSON")
    .action(async (repo: string, options: BrowseOptions) => {
      const value = {
        nodes: await executeCommand(
          browse,
          async () =>
            await feature.browse({
              ...(await listing(repo)),
              ...filters(options),
              ...(options.parent === undefined ? {} : { parentNodeId: options.parent }),
              ...(options.recursive === true ? { recursive: true } : {}),
            }),
        ),
      };
      present(browse, options, value);
    });
  const find = new Command("find")
    .description("Find Nodes by name across a Space or a fork")
    .argument("<query...>", "name query")
    .requiredOption("--space <repo>", LISTED_REPO)
    .option("--resource-kind <kind>", "none, univer, or blob")
    .option("--unit-type <type>", "sheet, base, doc, slide, or board")
    .option("--json", "write structured JSON")
    .action(async (query: string[], options: BrowseOptions & { readonly space: string }) => {
      const value = {
        nodes: await executeCommand(
          find,
          async () =>
            await feature.find({
              query: query.join(" "),
              ...(await listing(options.space)),
              ...filters(options),
            }),
        ),
      };
      present(find, options, value);
    });
  const node = new Command("node").description("Manage Workspace Nodes");
  const create = new Command("create")
    .description("Create an organizational Node in a repository")
    .argument("<repo>", "owner/slug, unique bare slug from repo list, Space ID or URL")
    .requiredOption("--name <name>", "Node name")
    .option("--parent <node>", "parent Node ID")
    .option("--json", "write structured JSON")
    .action(
      async (
        repo: string,
        options: JsonOption & { readonly name: string; readonly parent?: string },
      ) => {
        const value = {
          node: await executeCommand(
            create,
            async () =>
              await feature.createNode({
                name: options.name,
                spaceId: (await context.repo(repo)).spaceId,
                ...(options.parent === undefined ? {} : { parentNodeId: options.parent }),
              }),
          ),
        };
        present(create, options, value);
      },
    );
  const rename = new Command("rename")
    .description("Rename a Workspace Node")
    .argument("<node>", "Node ID")
    .requiredOption("--name <name>", "new Node name")
    .option("--json", "write structured JSON")
    .action(async (nodeId: string, options: JsonOption & { readonly name: string }) => {
      const value = {
        node: await executeCommand(
          rename,
          async () => await feature.renameNode({ name: options.name, nodeId }),
        ),
      };
      present(rename, options, value);
    });
  const move = new Command("move")
    .description("Move a Workspace Node to another parent or the Space root")
    .argument("<node>", "Node ID")
    .option("--parent <node>", "destination parent Node ID")
    .option("--root", "move to the root of the current Space")
    .option("--json", "write structured JSON")
    .action(
      async (
        nodeId: string,
        options: JsonOption & { readonly parent?: string; readonly root?: boolean },
      ) => {
        const value = {
          node: await executeCommand(move, async () => {
            return await feature.moveNode({
              nodeId,
              parentNodeId: nodeMoveParent(options, flag),
            });
          }),
        };
        present(move, options, value);
      },
    );
  const trash = new Command("trash")
    .description("Recursively move a Workspace Node subtree to Trash")
    .argument("<node>", "Node ID")
    .option("--json", "write structured JSON")
    .action(async (nodeId: string, options: JsonOption) => {
      const value = {
        trashBatch: await executeCommand(trash, async () => await feature.trashNode(nodeId)),
      };
      present(trash, options, value);
    });
  node.addCommand(create).addCommand(rename).addCommand(move).addCommand(trash);
  space.addCommand(browse).addCommand(find).addCommand(node);
  return space;
}

function filters(options: BrowseOptions): {
  readonly resourceKind?: WorkspaceResourceKindFilter;
  readonly unitType?: WorkspaceUnitType;
} {
  const resourceKind =
    options.resourceKind === undefined
      ? undefined
      : oneOf(options.resourceKind, ["none", "univer", "blob"], "--resource-kind");
  assertSpaceFilter(
    {
      ...(resourceKind === undefined ? {} : { resourceKind }),
      ...(options.unitType === undefined ? {} : { unitType: options.unitType }),
    },
    flag,
  );
  return {
    ...(resourceKind === undefined ? {} : { resourceKind }),
    ...(options.unitType === undefined
      ? {}
      : {
          unitType: oneOf(
            options.unitType,
            ["sheet", "base", "doc", "slide", "board"],
            "--unit-type",
          ),
        }),
  };
}
