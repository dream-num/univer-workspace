import { createInterface } from "node:readline";
import { Writable, type Readable } from "node:stream";
import { Command } from "commander";
import { executeCommand, present, type JsonOption } from "../../command.js";
import { workspaceError } from "../../errors.js";
import type { WorkspaceAuth } from "./session.js";

interface LoginOptions extends JsonOption {
  readonly complete?: boolean;
  readonly passwordStdin?: boolean;
  readonly username?: string;
}

export function createAuthCommands(auth: WorkspaceAuth): readonly Command[] {
  const login = new Command("login")
    .description("Start or complete a user-approved Workspace browser login")
    .option(
      "--complete",
      "complete the pending browser login after the user confirms approval",
    )
    .option(
      "--username <name>",
      "use Workspace username and password instead of browser approval",
    )
    .option("--password-stdin", "read the password from stdin (requires --username)")
    .option("--json", "write structured JSON")
    .addHelpText(
      "after",
      [
        "",
        "Agent browser-login workflow:",
        "  1. Run `univer-workspace-cli login`; it prints an approval URL and exits.",
        "  2. Send the URL and verification code to the user, then wait for their reply.",
        "  3. Only after the user confirms approval, run `univer-workspace-cli login --complete`.",
        "  Do not ask the user for a password and do not poll --complete while waiting.",
        "",
      ].join("\n"),
    )
    .action(async (options: LoginOptions) => {
      if (options.username !== undefined) {
        const username = options.username;
        const result = await executeCommand(login, async () => {
          if (options.complete === true) {
            throw workspaceError(
              "workspace-argument-invalid",
              "--complete cannot be combined with --username.",
            );
          }
          const password = (
            await readPassword(options.passwordStdin === true ? "stdin" : "interactive")
          ).replace(/\r?\n$/u, "");
          if (password === "") {
            throw workspaceError("workspace-argument-invalid", "Password is empty.");
          }
          return await auth.login({ password, username });
        });
        present(login, options, result, `Logged in to ${result.origin} as ${result.subject.name}`);
        return;
      }

      if (options.passwordStdin === true) {
        await executeCommand(login, async () => {
          throw workspaceError(
            "workspace-argument-invalid",
            "--password-stdin requires --username.",
          );
        });
        return;
      }

      if (options.complete === true) {
        const result = await executeCommand(login, async () => {
          const pending = await auth.pendingCliLogin();
          if (pending === undefined) {
            throw workspaceError(
              "workspace-cli-authorization-missing",
              "No pending browser login exists. Run login first.",
            );
          }
          const completion = await auth.completeCliLogin(pending);
          if (completion.status === "pending") {
            return {
              status: "authorization_pending" as const,
              origin: pending.origin,
              userCode: pending.userCode,
              verificationUrl: pending.verificationUrl,
            };
          }
          return completion;
        });
        if (result.status === "authorization_pending") {
          present(
            login,
            options,
            result,
            [
              "Browser approval has not completed.",
              "This command has exited and is not waiting.",
              "Ask the user to finish the approval, then run login --complete once more.",
            ].join("\n"),
          );
          return;
        }
        present(
          login,
          options,
          result,
          `Logged in to ${result.origin} as ${result.subject.name}`,
        );
        return;
      }

      const pending = await executeCommand(login, async () => await auth.startCliLogin());
      const result = {
        status: "authorization_required" as const,
        origin: pending.origin,
        userCode: pending.userCode,
        verificationUrl: pending.verificationUrl,
        expiresAt: new Date(pending.expiresAt).toISOString(),
        nextCommand: "univer-workspace-cli login --complete",
      };
      present(
        login,
        options,
        result,
        [
          "Browser approval required.",
          "",
          "Send this URL and verification code to the user:",
          pending.verificationUrl,
          `Verification code: ${pending.userCode}`,
          "",
          "This command has exited and is not waiting.",
          "Wait for the user to confirm approval. Do not poll in the meantime.",
          "After the user confirms, run:",
          "  univer-workspace-cli login --complete",
        ].join("\n"),
      );
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

export async function readPassword(
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
