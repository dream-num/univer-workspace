import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config } from "@univer-cli/config";
import {
  completeCliLogin as completeCliLoginProtocol,
  loginWithPassword,
  logout as logoutProtocol,
  startCliLogin as startCliLoginProtocol,
  whoami as whoamiProtocol,
  type PendingCliLogin,
  type WorkspaceSubject,
  WorkspaceHttp,
} from "@univerjs/univer-workspace-client-core";
import { WORKSPACE_ORIGIN_CONFIG_KEY } from "../../config.js";
import { workspaceError } from "../../errors.js";
import { isWorkspaceRecord } from "../../transport/http.js";

export type { PendingCliLogin, WorkspaceSubject } from "@univerjs/univer-workspace-client-core";

interface StoredSession {
  readonly cookie: string;
  readonly subject?: string;
}

interface StoredSessions {
  readonly pendingCliLogins: Readonly<Record<string, PendingCliLogin>>;
  readonly sessions: Readonly<Record<string, StoredSession>>;
}

export interface WorkspaceAuthOptions {
  readonly config: Config;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
  readonly sessionPath: string;
}

export type CliLoginCompletion =
  | { readonly status: "pending" }
  | {
      readonly status: "authenticated";
      readonly origin: string;
      readonly subject: WorkspaceSubject;
    };

export class WorkspaceAuth {
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: WorkspaceAuthOptions) {}

  public async login(input: {
    readonly password: string;
    readonly username: string;
  }): Promise<{ readonly origin: string; readonly subject: WorkspaceSubject }> {
    const origin = await this.configuredOrigin();
    const result = await loginWithPassword(this.unauthenticatedHttp(origin), input);
    await this.save(result.origin, { cookie: result.cookie, subject: result.subject.id });
    return { origin: result.origin, subject: result.subject };
  }

  public async startCliLogin(): Promise<PendingCliLogin> {
    const origin = await this.configuredOrigin();
    const pending = await startCliLoginProtocol(
      this.unauthenticatedHttp(origin),
      () => this.currentTime(),
    );
    await this.savePendingCliLogin(pending);
    return pending;
  }

  public async pendingCliLogin(): Promise<PendingCliLogin | undefined> {
    const origin = await this.configuredOrigin();
    const pending = (await readSessions(this.options.sessionPath)).pendingCliLogins[origin];
    if (pending === undefined) return undefined;
    if (pending.expiresAt <= this.currentTime()) {
      await this.clearPendingCliLogin(origin);
      return undefined;
    }
    return pending;
  }

  public async completeCliLogin(
    pending: PendingCliLogin,
  ): Promise<CliLoginCompletion> {
    const now = this.currentTime();
    const result = await completeCliLoginProtocol(
      this.unauthenticatedHttp(pending.origin),
      pending,
      () => now,
    ).catch(async (error: unknown) => {
      if (now >= pending.expiresAt) await this.clearPendingCliLogin(pending.origin);
      throw error;
    });
    if (result.status === "pending") return result;
    await this.save(result.origin, { cookie: result.cookie, subject: result.subject.id });
    return { status: "authenticated", origin: result.origin, subject: result.subject };
  }

  public async whoami(): Promise<{ readonly origin: string; readonly subject: WorkspaceSubject }> {
    return await whoamiProtocol(await this.authenticatedHttp("client"));
  }

  public async logout(): Promise<{ readonly loggedOut: true; readonly origin: string }> {
    const origin = await this.configuredOrigin();
    const cookie = await this.cookie(origin);
    try {
      if (cookie !== undefined) {
        await logoutProtocol(
          new WorkspaceHttp({
            cookie,
            origin,
            role: "client",
            ...(this.options.fetcher === undefined ? {} : { fetcher: this.options.fetcher }),
          }),
        );
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

  private unauthenticatedHttp(origin: string): WorkspaceHttp {
    return new WorkspaceHttp({
      origin,
      role: "client",
      ...(this.options.fetcher === undefined ? {} : { fetcher: this.options.fetcher }),
    });
  }

  private currentTime(): number {
    return (this.options.now ?? Date.now)();
  }

  private async cookie(origin: string): Promise<string | undefined> {
    return (await readSessions(this.options.sessionPath)).sessions[normalizeOrigin(origin)]?.cookie;
  }

  private async save(origin: string, session: StoredSession): Promise<void> {
    await this.mutate((current) => {
      const normalizedOrigin = normalizeOrigin(origin);
      const pendingCliLogins = { ...current.pendingCliLogins };
      delete pendingCliLogins[normalizedOrigin];
      return {
        pendingCliLogins,
        sessions: { ...current.sessions, [normalizedOrigin]: session },
      };
    });
  }

  private async savePendingCliLogin(pending: PendingCliLogin): Promise<void> {
    await this.mutate((current) => ({
      pendingCliLogins: {
        ...current.pendingCliLogins,
        [normalizeOrigin(pending.origin)]: pending,
      },
      sessions: current.sessions,
    }));
  }

  private async clearPendingCliLogin(origin: string): Promise<void> {
    await this.mutate((current) => {
      const pendingCliLogins = { ...current.pendingCliLogins };
      delete pendingCliLogins[normalizeOrigin(origin)];
      return { pendingCliLogins, sessions: current.sessions };
    });
  }

  private async clear(origin: string): Promise<void> {
    await this.mutate((current) => {
      const normalizedOrigin = normalizeOrigin(origin);
      const sessions = { ...current.sessions };
      const pendingCliLogins = { ...current.pendingCliLogins };
      delete sessions[normalizedOrigin];
      delete pendingCliLogins[normalizedOrigin];
      return { pendingCliLogins, sessions };
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
    if (isNodeError(error) && error.code === "ENOENT") {
      return { pendingCliLogins: {}, sessions: {} };
    }
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
      candidate["cookie"].length === 0 ||
      (candidate["subject"] !== undefined && typeof candidate["subject"] !== "string") ||
      candidate["subject"] === ""
    ) {
      throw sessionError();
    }
    sessions[normalizeStoredOrigin(origin)] = {
      cookie: candidate["cookie"],
      ...(candidate["subject"] === undefined ? {} : { subject: candidate["subject"] }),
    };
  }
  const pendingCliLogins: Record<string, PendingCliLogin> = {};
  const pendingValue = value["pendingCliLogins"];
  if (pendingValue !== undefined) {
    if (!isWorkspaceRecord(pendingValue)) throw sessionError();
    for (const [origin, candidate] of Object.entries(pendingValue)) {
      if (!isPendingCliLogin(candidate)) throw sessionError();
      const normalizedOrigin = normalizeStoredOrigin(origin);
      if (normalizeStoredOrigin(candidate.origin) !== normalizedOrigin) throw sessionError();
      let verificationUrl: URL;
      try {
        verificationUrl = new URL(candidate.verificationUrl);
      } catch {
        throw sessionError();
      }
      if (
        verificationUrl.origin !== normalizedOrigin ||
        verificationUrl.username !== "" ||
        verificationUrl.password !== ""
      ) {
        throw sessionError();
      }
      pendingCliLogins[normalizedOrigin] = candidate;
    }
  }
  return { pendingCliLogins, sessions };
}

async function writeSessions(path: string, value: StoredSessions): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  const serialized = {
    sessions: value.sessions,
    ...(Object.keys(value.pendingCliLogins).length === 0
      ? {}
      : { pendingCliLogins: value.pendingCliLogins }),
  };
  await writeFile(temporaryPath, `${JSON.stringify(serialized, undefined, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

function isPendingCliLogin(value: unknown): value is PendingCliLogin {
  return (
    isWorkspaceRecord(value) &&
    typeof value["deviceCode"] === "string" &&
    value["deviceCode"].length > 0 &&
    typeof value["expiresAt"] === "number" &&
    Number.isFinite(value["expiresAt"]) &&
    typeof value["origin"] === "string" &&
    value["origin"].length > 0 &&
    typeof value["userCode"] === "string" &&
    value["userCode"].length > 0 &&
    typeof value["verificationUrl"] === "string" &&
    value["verificationUrl"].length > 0
  );
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw workspaceError("workspace-origin-invalid", `Invalid Workspace origin: ${value}`);
  }
}

function normalizeStoredOrigin(value: string): string {
  let origin: string;
  try {
    origin = normalizeOrigin(value);
  } catch {
    throw sessionError();
  }
  if (origin !== value) throw sessionError();
  return origin;
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
