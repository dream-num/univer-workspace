import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { workspaceError, type WorkspaceIssueFeature } from "@univerjs/univer-workspace-client-core";
import { executeCommand, oneOf, present, type JsonOption } from "../../command.js";

const LABEL_COLORS = ["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink"] as const;

interface TextOptions {
  readonly body?: string;
  readonly bodyFile?: string;
}

function collect(value: string, previous: readonly string[] = []): string[] {
  return [...previous, value];
}

function issueNumber(value: string): number {
  const number = /^#?([1-9]\d{0,9})$/.exec(value.trim())?.[1];
  if (number === undefined) {
    throw workspaceError("workspace-argument-invalid", `Issue number must look like 12 or #12, got "${value}".`);
  }
  return Number(number);
}

/** `-` reads stdin so agents can pass multi-line Markdown without shell escaping. */
async function readText(inline: string | undefined, file: string | undefined, names: string): Promise<string | undefined> {
  if (inline !== undefined && file !== undefined) {
    throw workspaceError("workspace-argument-invalid", `Use either ${names}, not both.`);
  }
  if (file === undefined) return inline;
  if (file !== "-") return await readFile(file, "utf8");
  let text = "";
  for await (const chunk of process.stdin) {
    text += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  }
  return text;
}

export function createIssueCommand(feature: WorkspaceIssueFeature): Command {
  const root = new Command("issue").description(
    "Read and operate Team Space Issues. Issues are addressed by Space and number (#12).",
  );

  const list = new Command("list")
    .description("List Issues in one Space, or across every Team Space when --space is omitted")
    .option("--space <id>", "Space ID")
    .option("--state <state>", "open, closed or all", "open")
    .option("--label <name>", "require a label; repeat for several", collect)
    .option("--assignee <user>", "user ID, me, or none")
    .option("--author <user>", "user ID or me")
    .option("--search <text>", "match title and body")
    .option("--sort <field>", "created or updated")
    .option("--order <order>", "asc or desc")
    .option("--limit <n>", "page size, 1-200")
    .option("--cursor <cursor>", "cursor from a previous page")
    .option("--json", "write structured JSON")
    .action(
      async (
        options: JsonOption & {
          readonly assignee?: string;
          readonly author?: string;
          readonly cursor?: string;
          readonly label?: readonly string[];
          readonly limit?: string;
          readonly order?: string;
          readonly search?: string;
          readonly sort?: string;
          readonly space?: string;
          readonly state: string;
        },
      ) => {
        const page = await executeCommand(list, async () =>
          await feature.list({
            state: oneOf(options.state, ["open", "closed", "all"], "--state"),
            ...(options.space === undefined ? {} : { spaceId: options.space }),
            ...(options.label === undefined ? {} : { labels: options.label }),
            ...(options.assignee === undefined ? {} : { assignee: options.assignee }),
            ...(options.author === undefined ? {} : { author: options.author }),
            ...(options.search === undefined ? {} : { search: options.search }),
            ...(options.sort === undefined ? {} : { sort: oneOf(options.sort, ["created", "updated"], "--sort") }),
            ...(options.order === undefined ? {} : { order: oneOf(options.order, ["asc", "desc"], "--order") }),
            ...(options.limit === undefined ? {} : { limit: Number(options.limit) }),
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
          }),
        );
        present(list, options, page);
      },
    );

  const get = new Command("get")
    .description("Read an Issue with its body, labels, assignees and referenced files")
    .argument("<number>", "Issue number, e.g. 12 or #12")
    .requiredOption("--space <id>", "Space ID")
    .option("--timeline", "include every comment and event")
    .option("--json", "write structured JSON")
    .action(async (number: string, options: JsonOption & { readonly space: string; readonly timeline?: boolean }) => {
      const value = await executeCommand(get, async () => {
        const id = issueNumber(number);
        const issue = await feature.get(options.space, id);
        return options.timeline === true
          ? { issue, timeline: await feature.timeline(options.space, id) }
          : { issue };
      });
      present(get, options, value);
    });

  const create = new Command("create")
    .description("Open an Issue")
    .requiredOption("--space <id>", "Space ID")
    .requiredOption("--title <title>")
    .option("--body <markdown>")
    .option("--body-file <path>", "read the body from a file, or - for stdin")
    .option("--label <name>", "label name; repeat for several", collect)
    .option("--assignee <user>", "user ID or me; repeat for several", collect)
    .option("--node <id>", "reference a Node; repeat for several", collect)
    .option("--json")
    .action(
      async (
        options: JsonOption &
          TextOptions & {
            readonly assignee?: readonly string[];
            readonly label?: readonly string[];
            readonly node?: readonly string[];
            readonly space: string;
            readonly title: string;
          },
      ) => {
        const issue = await executeCommand(create, async () => {
          const body = await readText(options.body, options.bodyFile, "--body or --body-file");
          return await feature.create({
            spaceId: options.space,
            title: options.title,
            ...(body === undefined ? {} : { body }),
            ...(options.label === undefined ? {} : { labels: options.label }),
            ...(options.assignee === undefined ? {} : { assignees: options.assignee }),
            ...(options.node === undefined ? {} : { nodeIds: options.node }),
          });
        });
        present(create, options, { issue });
      },
    );

  const update = new Command("update")
    .description("Change an Issue's text or its labels, assignees and referenced files")
    .argument("<number>")
    .requiredOption("--space <id>", "Space ID")
    .option("--title <title>")
    .option("--body <markdown>")
    .option("--body-file <path>", "read the body from a file, or - for stdin")
    .option("--add-label <name>", "repeatable", collect)
    .option("--remove-label <name>", "repeatable", collect)
    .option("--add-assignee <user>", "user ID or me; repeatable", collect)
    .option("--remove-assignee <user>", "repeatable", collect)
    .option("--add-node <id>", "repeatable", collect)
    .option("--remove-node <id>", "repeatable", collect)
    .option("--json")
    .action(
      async (
        number: string,
        options: JsonOption &
          TextOptions & {
            readonly addAssignee?: readonly string[];
            readonly addLabel?: readonly string[];
            readonly addNode?: readonly string[];
            readonly removeAssignee?: readonly string[];
            readonly removeLabel?: readonly string[];
            readonly removeNode?: readonly string[];
            readonly space: string;
            readonly title?: string;
          },
      ) => {
        const issue = await executeCommand(update, async () => {
          const body = await readText(options.body, options.bodyFile, "--body or --body-file");
          return await feature.update(options.space, issueNumber(number), {
            ...(options.title === undefined ? {} : { title: options.title }),
            ...(body === undefined ? {} : { body }),
            ...(options.addLabel === undefined ? {} : { addLabels: options.addLabel }),
            ...(options.removeLabel === undefined ? {} : { removeLabels: options.removeLabel }),
            ...(options.addAssignee === undefined ? {} : { addAssignees: options.addAssignee }),
            ...(options.removeAssignee === undefined ? {} : { removeAssignees: options.removeAssignee }),
            ...(options.addNode === undefined ? {} : { addNodes: options.addNode }),
            ...(options.removeNode === undefined ? {} : { removeNodes: options.removeNode }),
          });
        });
        present(update, options, { issue });
      },
    );

  const close = new Command("close")
    .description("Close an Issue, optionally with a final comment")
    .argument("<number>")
    .requiredOption("--space <id>", "Space ID")
    .option("--reason <reason>", "completed or not-planned", "completed")
    .option("--comment <markdown>")
    .option("--comment-file <path>", "read the comment from a file, or - for stdin")
    .option("--json")
    .action(
      async (
        number: string,
        options: JsonOption & { readonly comment?: string; readonly commentFile?: string; readonly reason: string; readonly space: string },
      ) => {
        const issue = await executeCommand(close, async () => {
          const comment = await readText(options.comment, options.commentFile, "--comment or --comment-file");
          const reason = oneOf(options.reason, ["completed", "not-planned"], "--reason");
          return await feature.close(options.space, issueNumber(number), {
            reason: reason === "completed" ? "completed" : "not_planned",
            ...(comment === undefined ? {} : { comment }),
          });
        });
        present(close, options, { issue });
      },
    );

  const reopen = new Command("reopen")
    .argument("<number>")
    .requiredOption("--space <id>", "Space ID")
    .option("--json")
    .action(async (number: string, options: JsonOption & { readonly space: string }) => {
      const issue = await executeCommand(reopen, async () =>
        await feature.reopen(options.space, issueNumber(number)));
      present(reopen, options, { issue });
    });

  const comment = new Command("comment")
    .description("Comment on an Issue")
    .argument("<number>")
    .requiredOption("--space <id>", "Space ID")
    .option("--body <markdown>")
    .option("--body-file <path>", "read the comment from a file, or - for stdin")
    .option("--json")
    .action(async (number: string, options: JsonOption & TextOptions & { readonly space: string }) => {
      const value = await executeCommand(comment, async () => {
        const body = await readText(options.body, options.bodyFile, "--body or --body-file");
        if (body === undefined) {
          throw workspaceError("workspace-argument-invalid", "--body or --body-file is required.");
        }
        return await feature.comment(options.space, issueNumber(number), body);
      });
      present(comment, options, { comment: value });
    });

  root
    .addCommand(list)
    .addCommand(get)
    .addCommand(create)
    .addCommand(update)
    .addCommand(close)
    .addCommand(reopen)
    .addCommand(comment)
    .addCommand(createLabelCommand(feature));
  return root;
}

function createLabelCommand(feature: WorkspaceIssueFeature): Command {
  const label = new Command("label").description("Manage a Space's Issue labels");
  const list = new Command("list")
    .requiredOption("--space <id>", "Space ID")
    .option("--json")
    .action(async (options: JsonOption & { readonly space: string }) => {
      const labels = await executeCommand(list, async () => await feature.labels(options.space));
      present(list, options, { labels });
    });
  const create = new Command("create")
    .argument("<name>")
    .requiredOption("--space <id>", "Space ID")
    .requiredOption("--color <color>", LABEL_COLORS.join(", "))
    .option("--description <text>")
    .option("--json")
    .action(
      async (
        name: string,
        options: JsonOption & { readonly color: string; readonly description?: string; readonly space: string },
      ) => {
        const created = await executeCommand(create, async () =>
          await feature.createLabel(options.space, {
            name,
            color: oneOf(options.color, LABEL_COLORS, "--color"),
            ...(options.description === undefined ? {} : { description: options.description }),
          }));
        present(create, options, { label: created });
      },
    );
  const update = new Command("update")
    .argument("<name>")
    .requiredOption("--space <id>", "Space ID")
    .option("--name <name>", "new name")
    .option("--color <color>", LABEL_COLORS.join(", "))
    .option("--description <text>")
    .option("--json")
    .action(
      async (
        name: string,
        options: JsonOption & { readonly color?: string; readonly description?: string; readonly name?: string; readonly space: string },
      ) => {
        const updated = await executeCommand(update, async () =>
          await feature.updateLabel(options.space, name, {
            ...(options.name === undefined ? {} : { name: options.name }),
            ...(options.color === undefined ? {} : { color: oneOf(options.color, LABEL_COLORS, "--color") }),
            ...(options.description === undefined ? {} : { description: options.description }),
          }));
        present(update, options, { label: updated });
      },
    );
  const remove = new Command("delete")
    .argument("<name>")
    .requiredOption("--space <id>", "Space ID")
    .option("--json")
    .action(async (name: string, options: JsonOption & { readonly space: string }) => {
      const value = await executeCommand(remove, async () => await feature.deleteLabel(options.space, name));
      present(remove, options, value);
    });
  return label.addCommand(list).addCommand(create).addCommand(update).addCommand(remove);
}
