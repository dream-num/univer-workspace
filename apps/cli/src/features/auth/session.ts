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
  readonly pendingCliLogins: Readonly<Record<string, PendingCliLogin>>;
  readonly sessions: Readonly<Record<string, StoredSession>>;
}

export interface WorkspaceAuthOptions {
  readonly config: Config;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
  readonly sessionPath: string;
}

export interface PendingCliLogin {
  readonly deviceCode: string;
  readonly expiresAt: number;
  readonly origin: string;
  readonly userCode: string;
  readonly verificationUrl: string;
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

  public async startCliLogin(): Promise<PendingCliLogin> {
    const origin = await this.configuredOrigin();
    const response = await this.unauthenticatedHttp(origin).request(
      "/api/auth/cli/authorizations",
      { authenticated: false, method: "POST" },
    );
    const body = await readJsonResponse(response);
    const deviceCode = requiredString(body["deviceCode"], "deviceCode");
    const userCode = requiredString(body["userCode"], "userCode");
    const verificationUriComplete = requiredString(
      body["verificationUriComplete"],
      "verificationUriComplete",
    );
    const expiresIn = requiredPositiveInteger(body["expiresIn"], "expiresIn");
    requiredPositiveInteger(body["interval"], "interval");
    const verificationUrl = new URL(verificationUriComplete, origin);
    if (
      verificationUrl.origin !== origin ||
      verificationUrl.username !== "" ||
      verificationUrl.password !== ""
    ) {
      throw responseError("CLI login verification URL is invalid or cross-origin.");
    }
    const pending = {
      deviceCode,
      expiresAt: this.currentTime() + expiresIn * 1000,
      origin,
      userCode,
      verificationUrl: verificationUrl.href,
    };
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
    if (this.currentTime() >= pending.expiresAt) {
      await this.clearPendingCliLogin(pending.origin);
      throw workspaceError(
        "workspace-cli-authorization-expired",
        "The browser login request expired. Run login again.",
      );
    }
    const response = await this.unauthenticatedHttp(pending.origin).request(
      "/api/auth/cli/authorizations/exchange",
      {
        authenticated: false,
        body: { deviceCode: pending.deviceCode },
        method: "POST",
      },
    );
    if (response.status === 202) {
      const body = await readJsonResponse(response);
      if (body["status"] !== "pending") {
        throw responseError("CLI login completion response is invalid.");
      }
      return { status: "pending" };
    }
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    if (cookie === undefined || cookie.length === 0) {
      throw responseError("CLI login response did not include a Session cookie.");
    }
    const body = await readJsonResponse(response);
    if (body["authenticated"] !== true) {
      throw responseError("CLI login response is not an authenticated Session.");
    }
    const subject = parseSubject(body["user"]);
    await this.save(pending.origin, { cookie, subject: subject.id });
    return { status: "authenticated", origin: pending.origin, subject };
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
      (candidate["subject"] !== undefined && typeof candidate["subject"] !== "string")
    ) {
      throw sessionError();
    }
    sessions[normalizeOrigin(origin)] = {
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
      const normalizedOrigin = normalizeOrigin(origin);
      if (normalizeOrigin(candidate.origin) !== normalizedOrigin) throw sessionError();
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
    typeof value["expiresAt"] === "number" &&
    Number.isFinite(value["expiresAt"]) &&
    typeof value["origin"] === "string" &&
    typeof value["userCode"] === "string" &&
    typeof value["verificationUrl"] === "string"
  );
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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw responseError(`CLI login response contains an invalid ${field}.`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw responseError(`CLI login response contains an invalid ${field}.`);
  }
  return value;
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
