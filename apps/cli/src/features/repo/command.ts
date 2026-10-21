import { Command } from "commander";
import type { WorkspaceSpace, WorkspaceSpaceFeature } from "@univerjs/univer-workspace-client-core/product";
import { workspaceError } from "../../errors.js";
import {
  emit,
  executeCommand,
  jsonFieldsOption,
  limitOf,
  oneOf,
  table,
  type JsonFieldsOption,
} from "../../command.js";
import { REPO_OPTION, type RepoContext } from "../../repo-context.js";

const JSON_OPTION = ["--json [fields]", "write JSON, optionally only these comma-separated fields"] as const;
export const REPO_JSON_FIELDS = [
  "id", "name", "type", "accessRole", "description", "fullName", "owner", "publicRead", "slug",
] as const satisfies readonly (keyof WorkspaceSpace)[];

export function createRepoCommand(spaces: WorkspaceSpaceFeature, context: RepoContext): Command {
  const root = new Command("repo").description(
    "Work with repositories (Spaces), named owner/slug; owner/personal is a Personal Space",
  );

  const list = new Command("list")
    .description("List repositories you can access")
    .option("--owner <user>", "only repositories owned by this username, or @me")
    .option("--type <type>", "team or personal")
    .option("-L, --limit <n>", "maximum number of repositories", "30")
    .option(...JSON_OPTION)
    .action(
      async (options: JsonFieldsOption & { limit: string; owner?: string; type?: string }) => {
        const all = await executeCommand(list, async () => {
          const type =
            options.type === undefined ? undefined : oneOf(options.type, ["team", "personal"], "--type");
          const limit = limitOf(options.limit);
          const owner = options.owner?.toLowerCase();
          return (await spaces.list())
            .filter((space) => type === undefined || space.type === type)
            .filter(
              (space) =>
                owner === undefined ||
                (owner === "@me" ? space.accessRole === "owner" : space.owner?.username.toLowerCase() === owner),
            )
            .slice(0, limit);
        });
        emit(
          list,
          options,
          all,
          table(all.map((space) => [nameOf(space), visibility(space), space.accessRole ?? "", space.description ?? ""])),
        );
      },
    );

  const view = new Command("view")
    .description("Show a repository")
    .argument("[ref]", "owner/slug, Space ID or URL (default: $UVW_REPO)")
    .option(...JSON_OPTION)
    .action(async (ref: string | undefined, options: JsonFieldsOption) => {
      const space = await executeCommand(view, async () => {
        const { spaceId } = await context.repo(ref);
        return { ...(await spaces.get(spaceId)), ...(await spaces.getStar(spaceId)) };
      });
      emit(
        view,
        options,
        space,
        [
          `${nameOf(space)}  (${space.name})`,
          `${visibility(space)} ${space.type ?? "space"}, your role: ${space.accessRole ?? "unknown"}, ${space.starCount} stars`,
          `id: ${space.id}`,
          ...(space.description ? ["", space.description] : []),
        ].join("\n"),
      );
    });

  const create = new Command("create")
    .description("Create a Team Space repository")
    .argument("<slug>", "repository slug: letters, digits, '.', '_' and '-'")
    .option("--name <name>", "display name (default: the slug)")
    .option("--description <text>", "short plain-text description")
    .option("--public", "let anyone with the link read it")
    .addOption(jsonFieldsOption(REPO_JSON_FIELDS))
    .action(
      async (
        slug: string,
        options: JsonFieldsOption & { description?: string; name?: string; public?: boolean },
      ) => {
        const space = await executeCommand(create, async () => {
          const created = await spaces.create({
            name: options.name ?? slug,
            slug,
            ...(options.public === true ? { publicRead: true } : {}),
          });
          return options.description === undefined
            ? created
            : await spaces.update(created.id, { description: options.description });
        });
        emit(create, options, space, nameOf(space));
      },
    );

  const edit = new Command("edit")
    .description("Change a repository's display name, description or visibility")
    .argument("[ref]", "owner/slug, Space ID or URL (default: $UVW_REPO)")
    .option("--name <name>")
    .option("--description <text>", "plain text; an empty string clears it")
    .option("--visibility <visibility>", "public or private")
    .addOption(jsonFieldsOption(REPO_JSON_FIELDS))
    .action(
      async (
        ref: string | undefined,
        options: JsonFieldsOption & { description?: string; name?: string; visibility?: string },
      ) => {
        const space = await executeCommand(edit, async () => {
          if (
            options.name === undefined &&
            options.description === undefined &&
            options.visibility === undefined
          ) {
            throw workspaceError(
              "workspace-argument-invalid",
              "Nothing to change: pass --name, --description or --visibility.",
            );
          }
          const { spaceId } = await context.repo(ref);
          return await spaces.update(spaceId, {
            ...(options.name === undefined ? {} : { name: options.name }),
            ...(options.description === undefined ? {} : { description: options.description }),
            ...(options.visibility === undefined
              ? {}
              : { publicRead: oneOf(options.visibility, ["public", "private"], "--visibility") === "public" }),
          });
        });
        emit(edit, options, space, nameOf(space));
      },
    );

  const rename = new Command("rename")
    .description("Change a repository's slug; the old owner/slug stops resolving")
    .argument("<new-slug>")
    .option(...REPO_OPTION)
    .addOption(jsonFieldsOption(REPO_JSON_FIELDS))
    .action(async (slug: string, options: JsonFieldsOption & { repo?: string }) => {
      const space = await executeCommand(rename, async () => {
        const { spaceId } = await context.repo(options.repo);
        return await spaces.update(spaceId, { slug });
      });
      emit(rename, options, space, nameOf(space));
    });

  return root
    .addCommand(list)
    .addCommand(view)
    .addCommand(create)
    .addCommand(edit)
    .addCommand(rename);
}

/** `owner/slug`, falling back to the ID for a Team Space created before slugs existed. */
function nameOf(space: WorkspaceSpace): string {
  return space.fullName ?? space.id;
}

function visibility(space: WorkspaceSpace): string {
  return space.publicRead === true ? "public" : "private";
}
