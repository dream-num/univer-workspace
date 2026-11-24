import { Command } from "commander";
import {
  createRepo,
  repoEditPatch,
  selectRepos,
  SPACE_PROPOSALS,
  TEAM_ROLES,
  type WorkspaceSpace,
  type WorkspaceSpaceFeature,
  type WorkspaceTeamMember,
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
import { workspaceError } from "../../errors.js";
import { REPO_OPTION, type RepoContext } from "../../repo-context.js";

export const REPO_JSON_FIELDS = [
  "id", "name", "type", "accessRole", "affiliation", "description", "fullName", "owner", "publicRead", "slug",
  "proposals", "acceptAfterHours", "capabilities",
] as const satisfies readonly (keyof WorkspaceSpace)[];

const MEMBER_JSON_FIELDS = ["user", "role", "grantedBy", "createdAt", "updatedAt"] as const satisfies
  readonly (keyof WorkspaceTeamMember)[];

const flag = (parameter: string) => `--${parameter.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
const PROPOSALS_HELP =
  "who besides members may fork and propose while it is public: members, accountable (any person or claimed agent) or anyone";
const proposalsOf = (value: string) => oneOf(value, SPACE_PROPOSALS, "--proposals");
const hoursOf = (value: string): number | null => {
  if (value === "off") return null;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 720) {
    throw workspaceError("workspace-argument-invalid", "--accept-after-hours must be off or a whole number of hours from 1 to 720.");
  }
  return Number(value);
};

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
          ...(space.type === "team" && space.proposals !== undefined ? [`proposals: ${space.proposals}`] : []),
          ...(space.type === "team" && space.acceptAfterHours !== undefined
            ? [`accept after: ${space.acceptAfterHours === null ? "off" : `${String(space.acceptAfterHours)} hours`}`]
            : []),
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
    .option("--proposals <who>", PROPOSALS_HELP)
    .addOption(jsonFieldsOption(REPO_JSON_FIELDS))
    .action(
      async (
        slug: string,
        options: JsonFieldsOption & { description?: string; name?: string; proposals?: string; public?: boolean },
      ) => {
        const space = await executeCommand(create, async () => {
          return await createRepo(
            spaces,
            {
              slug,
              ...(options.description === undefined ? {} : { description: options.description }),
              ...(options.name === undefined ? {} : { name: options.name }),
              ...(options.public === true ? { public: true } : {}),
              ...(options.proposals === undefined ? {} : { proposals: proposalsOf(options.proposals) }),
            },
            flag,
          );
        });
        emit(create, options, space, nameOf(space));
      },
    );

  const edit = new Command("edit")
    .description("Change a repository's display name, description, visibility, proposals setting or acceptance deadline")
    .argument("[ref]", "owner/slug, unique bare slug from repo list, Space ID or URL (default: $UVW_REPO)")
    .option("--name <name>")
    .option("--description <text>", "plain text; an empty string clears it")
    .option("--visibility <visibility>", "public or private")
    .option("--proposals <who>", PROPOSALS_HELP)
    .option(
      "--accept-after-hours <n|off>",
      "accept a submitted Issue nobody sent back after n hours (1 to 720, 72 is typical), or off",
    )
    .addOption(jsonFieldsOption(REPO_JSON_FIELDS))
    .action(
      async (
        ref: string | undefined,
        options: JsonFieldsOption & {
          acceptAfterHours?: string;
          description?: string;
          name?: string;
          proposals?: string;
          visibility?: string;
        },
      ) => {
        const space = await executeCommand(edit, async () => {
          const patch = repoEditPatch(
            {
              ...(options.name === undefined ? {} : { name: options.name }),
              ...(options.description === undefined ? {} : { description: options.description }),
              ...(options.visibility === undefined
                ? {}
                : { visibility: oneOf(options.visibility, ["public", "private"], "--visibility") }),
              ...(options.proposals === undefined ? {} : { proposals: proposalsOf(options.proposals) }),
              ...(options.acceptAfterHours === undefined ? {} : { acceptAfterHours: hoursOf(options.acceptAfterHours) }),
            },
            ["name", "description", "visibility", "proposals", "acceptAfterHours"],
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
    .addCommand(rename)
    .addCommand(createMemberCommand(spaces, context));
}

function createMemberCommand(spaces: WorkspaceSpaceFeature, context: RepoContext): Command {
  const member = new Command("member").description(
    "Manage a Team repository's members; needs capabilities.manageMembers from repo view --json",
  );
  const spaceId = async (options: { readonly repo?: string }) => (await context.repo(options.repo)).spaceId;
  const role = (value: string) => oneOf(value, TEAM_ROLES, "--role");

  const list = new Command("list")
    .description("List the owner and the members with their roles")
    .option(...REPO_OPTION)
    .addOption(jsonFieldsOption(["owner", "members"]))
    .action(async (options: JsonFieldsOption & { repo?: string }) => {
      const team = await executeCommand(list, async () => await spaces.members(await spaceId(options)));
      emit(
        list,
        options,
        team,
        table([
          [team.owner.username, "owner"],
          ...team.members.map((item) => [item.user.username, item.role]),
        ]),
      );
    });

  const add = new Command("add")
    .description("Add a user, named by username or user ID, with a role")
    .argument("<user>")
    .requiredOption("--role <role>", TEAM_ROLES.join(", "))
    .option(...REPO_OPTION)
    .addOption(jsonFieldsOption(MEMBER_JSON_FIELDS))
    .action(async (user: string, options: JsonFieldsOption & { repo?: string; role: string }) => {
      const added = await executeCommand(add, async () =>
        await spaces.addMember(await spaceId(options), user, role(options.role)));
      emit(add, options, added, `Added ${added.user.username} as ${added.role}`);
    });

  const edit = new Command("edit")
    .description("Change a member's role")
    .argument("<user>")
    .requiredOption("--role <role>", TEAM_ROLES.join(", "))
    .option(...REPO_OPTION)
    .addOption(jsonFieldsOption(MEMBER_JSON_FIELDS))
    .action(async (user: string, options: JsonFieldsOption & { repo?: string; role: string }) => {
      const edited = await executeCommand(edit, async () =>
        await spaces.editMember(await spaceId(options), user, role(options.role)));
      emit(edit, options, edited, `${edited.user.username} is now ${edited.role}`);
    });

  const remove = new Command("remove")
    .description("Remove a member, or leave the repository yourself")
    .argument("<user>")
    .option(...REPO_OPTION)
    .addOption(jsonFieldsOption(["removed"]))
    .action(async (user: string, options: JsonFieldsOption & { repo?: string }) => {
      const removed = await executeCommand(remove, async () => await spaces.removeMember(await spaceId(options), user));
      emit(remove, options, removed, `Removed ${removed.removed}`);
    });

  return member.addCommand(list).addCommand(add).addCommand(edit).addCommand(remove);
}

/** `owner/slug`, falling back to the ID for a Team Space created before slugs existed. */
function nameOf(space: WorkspaceSpace): string {
  return space.fullName ?? space.id;
}

function visibility(space: WorkspaceSpace): string {
  return space.publicRead === true ? "public" : "private";
}
