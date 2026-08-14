import { createInterface } from "node:readline";
import { Writable, type Readable } from "node:stream";
import { Command } from "commander";
import { executeCommand, present, type JsonOption } from "../../command.js";
import { workspaceError } from "../../errors.js";
import type { WorkspaceAuth } from "./session.js";

interface LoginOptions extends JsonOption {
  readonly passwordStdin?: boolean;
  readonly username: string;
}

export function createAuthCommands(auth: WorkspaceAuth): readonly Command[] {
  const login = new Command("login")
    .description("Log in to the configured Workspace")
    .requiredOption("--username <name>", "Workspace username")
    .option("--password-stdin", "read the password from stdin")
    .option("--json", "write structured JSON")
    .action(async (options: LoginOptions) => {
      const result = await executeCommand(login, async () => {
        const password = (
          await readPassword(options.passwordStdin === true ? "stdin" : "interactive")
        ).replace(/\r?\n$/u, "");
        if (password === "") {
          throw workspaceError("workspace-argument-invalid", "Password is empty.");
        }
        return await auth.login({ password, username: options.username });
      });
      present(login, options, result, `Logged in to ${result.origin} as ${result.subject.name}`);
    });

  const whoami = new Command("whoami")
    .description("Show the authenticated Workspace user")
    .option("--json", "write structured JSON")
    .action(async (options: JsonOption) => {
      const result = await executeCommand(whoami, async () => await auth.whoami());
      present(whoami, options, result, `${result.subject.name} (${result.subject.id})`);
    });

  const logout = new Command("logout")
    .description("Log out from the current Workspace origin")
    .option("--json", "write structured JSON")
    .action(async (options: JsonOption) => {
      const result = await executeCommand(logout, async () => await auth.logout());
      present(logout, options, result, `Logged out from ${result.origin}`);
    });

  return [login, whoami, logout];
}

type PasswordSource = "interactive" | "stdin";

async function readPassword(
  source: PasswordSource,
  streams: {
    readonly stderr: Writable;
    readonly stdin: Readable & { readonly isTTY?: boolean };
  } = { stderr: process.stderr, stdin: process.stdin },
): Promise<string> {
  if (source === "stdin") {
    if (streams.stdin.isTTY === true) {
      throw workspaceError(
        "workspace-password-input-invalid",
        "--password-stdin requires piped input. Remove the flag to enter the password interactively.",
      );
    }
    let password = "";
    for await (const chunk of streams.stdin) {
      password += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    }
    return password;
  }
  if (streams.stdin.isTTY !== true) {
    throw workspaceError(
      "workspace-password-input-invalid",
      "Interactive password entry requires a terminal. Pipe the password and add --password-stdin.",
    );
  }
  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback): void {
      callback();
    },
  });
  const readline = createInterface({ input: streams.stdin, output: mutedOutput, terminal: true });
  streams.stderr.write("Password: ");
  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    readline.once("line", (password) => {
      settled = true;
      readline.close();
      streams.stderr.write("\n");
      resolve(password);
    });
    readline.once("SIGINT", () => {
      settled = true;
      readline.close();
      streams.stderr.write("\n");
      reject(workspaceError("workspace-password-input-cancelled", "Password entry cancelled."));
    });
    readline.once("close", () => {
      if (settled) return;
      settled = true;
      streams.stderr.write("\n");
      reject(workspaceError("workspace-password-input-cancelled", "Password entry cancelled."));
    });
  });
}
