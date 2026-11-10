import { Command } from "commander";
import {
  createRepo,
  repoEditPatch,
  selectRepos,
  type WorkspaceSpace,
  type WorkspaceSpaceFeature,
} from "@univerjs/univer-workspace-client-core/product";
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

export const REPO_JSON_FIELDS = [
  "id", "name", "type", "accessRole", "affiliation", "description", "fullName", "owner", "publicRead", "slug",
] as const satisfies readonly (keyof WorkspaceSpace)[];

const flag = (parameter: string) => `--${parameter}`;

export function createRepoCommand(spaces: WorkspaceSpaceFeature, context: RepoContext): Command {
  const root = new Command("repo").description(
    "Work with repositories (Spaces), named owner/slug; owner/personal is a Personal Space",
  );

  const list = new Command("list")
    .description("List repositories you own or have joined")
    .option("--owner <user>", "only repositories owned by this username, or @me")
    .option("--type <type>", "team or personal")
    .option("-L, --limit <n>", "maximum number of repositories", "30")
    .addOption(jsonFieldsOption(REPO_JSON_FIELDS))
    .action(
      async (options: JsonFieldsOption & { limit: string; owner?: string; type?: string }) => {
        const all = await executeCommand(list, async () => {
          const type =
            options.type === undefined ? undefined : oneOf(options.type, ["team", "personal"], "--type");
          const limit = limitOf(options.limit);
          return selectRepos(await spaces.list(), {
            limit,
            ...(options.owner === undefined ? {} : { owner: options.owner }),
            ...(type === undefined ? {} : { type }),
          });
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
    .argument("[ref]", "owner/slug, unique bare slug from repo list, Space ID or URL (default: $UVW_REPO)")
    .addOption(jsonFieldsOption([...REPO_JSON_FIELDS, "starCount", "starred"]))
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
          return await createRepo(
            spaces,
            {
              slug,
              ...(options.description === undefined ? {} : { description: options.description }),
              ...(options.name === undefined ? {} : { name: options.name }),
              ...(options.public === true ? { public: true } : {}),
            },
            flag,
          );
        });
        emit(create, options, space, nameOf(space));
      },
    );

  const edit = new Command("edit")
    .description("Change a repository's display name, description or visibility")
    .argument("[ref]", "owner/slug, unique bare slug from repo list, Space ID or URL (default: $UVW_REPO)")
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
          const patch = repoEditPatch(
            {
              ...(options.name === undefined ? {} : { name: options.name }),
              ...(options.description === undefined ? {} : { description: options.description }),
              ...(options.visibility === undefined
                ? {}
                : { visibility: oneOf(options.visibility, ["public", "private"], "--visibility") }),
            },
            ["name", "description", "visibility"],
            flag,
          );
          const { spaceId } = await context.repo(ref);
          return await spaces.update(spaceId, patch);
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
