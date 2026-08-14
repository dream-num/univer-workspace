import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config } from "@univer-cli/config";
import { WORKSPACE_ORIGIN_CONFIG_KEY } from "../../config.js";
import { workspaceError } from "../../errors.js";
import { isWorkspaceRecord, WorkspaceHttp } from "../../transport/http.js";

export interface WorkspaceSubject {
  readonly id: string;
  readonly name: string;
}

interface StoredSession {
  readonly cookie: string;
  readonly subject?: string;
}

interface StoredSessions {
  readonly sessions: Readonly<Record<string, StoredSession>>;
}

export interface WorkspaceAuthOptions {
  readonly config: Config;
  readonly fetcher?: typeof fetch;
  readonly sessionPath: string;
}

export class WorkspaceAuth {
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: WorkspaceAuthOptions) {}

  public async login(input: {
    readonly password: string;
    readonly username: string;
  }): Promise<{ readonly origin: string; readonly subject: WorkspaceSubject }> {
    const origin = await this.configuredOrigin();
    const http = new WorkspaceHttp({
      origin,
      role: "client",
      ...(this.options.fetcher === undefined ? {} : { fetcher: this.options.fetcher }),
    });
    const response = await http.request("/api/auth/password/login", {
      authenticated: false,
      body: input,
      method: "POST",
    });
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    if (cookie === undefined || cookie.length === 0) {
      throw responseError("Login response did not include a Session cookie.");
    }
    const body = await readJsonResponse(response);
    if (!isWorkspaceRecord(body) || body["authenticated"] !== true) {
      throw responseError("Login response is not an authenticated Session.");
    }
    const subject = parseSubject(body["user"]);
    await this.save(origin, { cookie, subject: subject.id });
    return { origin, subject };
  }

  public async whoami(): Promise<{ readonly origin: string; readonly subject: WorkspaceSubject }> {
    const origin = await this.configuredOrigin();
    const body = await (await this.authenticatedHttp("client")).json("/api/session");
    if (body["authenticated"] !== true) {
      throw workspaceError(
        "workspace-authentication-required",
        "Workspace Session is missing or expired.",
      );
    }
    return { origin, subject: parseSubject(body["user"]) };
  }

  public async logout(): Promise<{ readonly loggedOut: true; readonly origin: string }> {
    const origin = await this.configuredOrigin();
    const cookie = await this.cookie(origin);
    try {
      if (cookie !== undefined) {
        await new WorkspaceHttp({
          cookie,
          origin,
          role: "client",
          ...(this.options.fetcher === undefined ? {} : { fetcher: this.options.fetcher }),
        }).request("/api/auth/logout", { method: "POST" });
      }
    } finally {
      await this.clear(origin);
    }
    return { loggedOut: true, origin };
  }

  public async authenticatedHttp(role: "client" | "worker"): Promise<WorkspaceHttp> {
    const origin = await this.configuredOrigin();
    const cookie = await this.cookie(origin);
    if (cookie === undefined) {
      throw workspaceError(
        "workspace-authentication-required",
        "Log in to the current Workspace origin first.",
      );
    }
    return new WorkspaceHttp({
      cookie,
      origin,
      role,
      ...(this.options.fetcher === undefined ? {} : { fetcher: this.options.fetcher }),
    });
  }

  public async configuredOrigin(): Promise<string> {
    const entry = await this.options.config.get({ key: WORKSPACE_ORIGIN_CONFIG_KEY });
    if (entry.source === "unset" || typeof entry.value !== "string") {
      throw workspaceError("workspace-origin-invalid", "workspace.origin is not configured.");
    }
    return normalizeOrigin(entry.value);
  }

  private async cookie(origin: string): Promise<string | undefined> {
    return (await readSessions(this.options.sessionPath)).sessions[normalizeOrigin(origin)]?.cookie;
  }

  private async save(origin: string, session: StoredSession): Promise<void> {
    await this.mutate((current) => ({
      sessions: { ...current.sessions, [normalizeOrigin(origin)]: session },
    }));
  }

  private async clear(origin: string): Promise<void> {
    await this.mutate((current) => {
      const sessions = { ...current.sessions };
      delete sessions[normalizeOrigin(origin)];
      return { sessions };
    });
  }

  private async mutate(transform: (current: StoredSessions) => StoredSessions): Promise<void> {
    const run = this.mutationQueue.then(async () => {
      await writeSessions(
        this.options.sessionPath,
        transform(await readSessions(this.options.sessionPath)),
      );
    });
    this.mutationQueue = run.catch(() => undefined);
    await run;
  }
}

export async function readWorkspaceCookie(input: {
  readonly origin: string;
  readonly sessionPath: string;
}): Promise<string | undefined> {
  return (await readSessions(input.sessionPath)).sessions[normalizeOrigin(input.origin)]?.cookie;
}

async function readSessions(path: string): Promise<StoredSessions> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { sessions: {} };
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw sessionError();
  }
  if (!isWorkspaceRecord(value) || !isWorkspaceRecord(value["sessions"])) throw sessionError();
  const sessions: Record<string, StoredSession> = {};
  for (const [origin, candidate] of Object.entries(value["sessions"])) {
    if (
      !isWorkspaceRecord(candidate) ||
      typeof candidate["cookie"] !== "string" ||
      (candidate["subject"] !== undefined && typeof candidate["subject"] !== "string")
    ) {
      throw sessionError();
    }
    sessions[normalizeOrigin(origin)] = {
      cookie: candidate["cookie"],
      ...(candidate["subject"] === undefined ? {} : { subject: candidate["subject"] }),
    };
  }
  return { sessions };
}

async function writeSessions(path: string, value: StoredSessions): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

function parseSubject(value: unknown): WorkspaceSubject {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["displayName"] !== "string"
  ) {
    throw responseError("Workspace response contains an invalid user.");
  }
  return { id: value["id"], name: value["displayName"] };
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw workspaceError("workspace-origin-invalid", `Invalid Workspace origin: ${value}`);
  }
}

function responseError(message: string): Error {
  return workspaceError("workspace-invalid-response", message);
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  let source: string;
  try {
    source = await response.text();
  } catch (error) {
    throw workspaceError(
      "workspace-result-unknown",
      "The Workspace request result is unknown because the response body was interrupted.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw responseError("Workspace returned invalid JSON.");
  }
  if (!isWorkspaceRecord(value)) {
    throw responseError("Workspace returned a non-object JSON payload.");
  }
  return value;
}

function sessionError(): Error {
  return workspaceError(
    "workspace-session-corrupt",
    "The persisted Workspace session file is invalid. Log in again after removing it.",
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
