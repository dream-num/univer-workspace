import {
  credentialKey,
  type CredentialProvider,
  type CredentialRecord,
} from "@deepseek-ai/dsh-credentials";
import {
  WorkspaceHttp,
  type WorkspaceSubject,
} from "@univerjs/univer-workspace-client-core";

export const WORKSPACE_CREDENTIAL_KEY = credentialKey("dsh-univer-work", "workspace");

export interface PendingWorkspaceGrant {
  readonly state: "pending";
  readonly origin: string;
  readonly deviceCode: string;
  readonly expiresAt: number;
  readonly userCode: string;
  readonly verificationUrl: string;
}

export interface AuthenticatedWorkspaceGrant {
  readonly state: "authenticated";
  readonly origin: string;
  readonly cookie: string;
  readonly subject: WorkspaceSubject;
}

export type WorkspaceGrant = PendingWorkspaceGrant | AuthenticatedWorkspaceGrant;

export class AuthenticatedWorkspaceHttp extends WorkspaceHttp {
  public constructor(
    grant: AuthenticatedWorkspaceGrant,
    role: "client" | "worker",
    fetcher?: typeof fetch,
  ) {
    super({
      cookie: grant.cookie,
      origin: grant.origin,
      role,
      ...(fetcher === undefined ? {} : { fetcher }),
    });
    this.credentialSecret = grant.cookie;
  }

  private readonly credentialSecret: string;

  public subjectExposesCredential(subject: WorkspaceSubject): boolean {
    return subjectExposesSecrets(subject, [this.credentialSecret]);
  }
}

export class WorkspaceCredentialError extends Error {
  public constructor() {
    super("The stored Workspace credential is invalid.");
    this.name = "WorkspaceCredentialError";
  }
}

export class WorkspaceAuthenticationRequiredError extends Error {
  public constructor() {
    super("Workspace authentication is required.");
    this.name = "WorkspaceAuthenticationRequiredError";
  }
}

export class AuthMutationQueue {
  private tail: Promise<void> = Promise.resolve();

  public run<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  public async drain(): Promise<void> {
    await this.tail;
  }
}

export function parseWorkspaceGrantRecord(record: CredentialRecord | undefined): WorkspaceGrant | undefined {
  if (record === undefined) return undefined;
  if (!isExactRecord(record, ["kind", "payload"]) || record.kind !== "grant") {
    throw new WorkspaceCredentialError();
  }
  const payload = record.payload;
  if (!isRecord(payload) || typeof payload.state !== "string") {
    throw new WorkspaceCredentialError();
  }
  if (payload.state === "pending") return parsePending(payload);
  if (payload.state === "authenticated") return parseAuthenticated(payload);
  throw new WorkspaceCredentialError();
}

export function grantRecord(grant: WorkspaceGrant): CredentialRecord {
  return { kind: "grant", payload: grant };
}

export function sameWorkspaceGrant(left: WorkspaceGrant | undefined, right: WorkspaceGrant | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.state !== right.state || left.origin !== right.origin) return false;
  if (left.state === "pending" && right.state === "pending") {
    return left.deviceCode === right.deviceCode
      && left.expiresAt === right.expiresAt
      && left.userCode === right.userCode
      && left.verificationUrl === right.verificationUrl;
  }
  return left.state === "authenticated" && right.state === "authenticated"
    && left.cookie === right.cookie
    && left.subject.id === right.subject.id
    && left.subject.name === right.subject.name;
}

export async function resolveAuthenticatedWorkspaceHttp(
  credentials: CredentialProvider,
  role: "client" | "worker",
  fetcher?: typeof fetch,
  signal?: AbortSignal,
): Promise<AuthenticatedWorkspaceHttp> {
  const record = await credentials.readRecord(WORKSPACE_CREDENTIAL_KEY);
  if (signal?.aborted === true) throw signal.reason;
  const grant = parseWorkspaceGrantRecord(record);
  if (grant?.state !== "authenticated") {
    throw new WorkspaceAuthenticationRequiredError();
  }
  return new AuthenticatedWorkspaceHttp(grant, role, fetcher);
}

export function subjectExposesSecrets(
  subject: WorkspaceSubject,
  secrets: readonly string[],
): boolean {
  return [subject.id, subject.name].some((value) =>
    secrets.some((secret) => exposesSecret(value, secret)));
}

function parsePending(payload: Record<string, unknown>): PendingWorkspaceGrant {
  if (!hasExactKeys(payload, ["deviceCode", "expiresAt", "origin", "state", "userCode", "verificationUrl"])) {
    throw new WorkspaceCredentialError();
  }
  const { deviceCode, expiresAt, origin, userCode, verificationUrl } = payload;
  if (
    typeof deviceCode !== "string"
    || deviceCode.length < 40
    || typeof expiresAt !== "number"
    || !Number.isSafeInteger(expiresAt)
    || expiresAt < 1
    || typeof origin !== "string"
    || typeof userCode !== "string"
    || !/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(userCode)
    || typeof verificationUrl !== "string"
  ) {
    throw new WorkspaceCredentialError();
  }
  const normalizedOrigin = normalizeOrigin(origin);
  if (normalizedOrigin !== origin) throw new WorkspaceCredentialError();
  if ([origin, userCode, verificationUrl].some((value) => exposesSecret(value, deviceCode))) {
    throw new WorkspaceCredentialError();
  }
  let url: URL;
  try {
    url = new URL(verificationUrl);
  } catch {
    throw new WorkspaceCredentialError();
  }
  const expectedUrl = `${origin}/cli-login?userCode=${encodeURIComponent(userCode)}`;
  if (
    url.href !== expectedUrl
    || url.origin !== origin
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/cli-login"
    || url.hash !== ""
    || url.searchParams.getAll("userCode").length !== 1
    || [...url.searchParams.keys()].some((key) => key !== "userCode")
  ) {
    throw new WorkspaceCredentialError();
  }
  return { state: "pending", deviceCode, expiresAt, origin, userCode, verificationUrl };
}

function parseAuthenticated(payload: Record<string, unknown>): AuthenticatedWorkspaceGrant {
  if (!hasExactKeys(payload, ["cookie", "origin", "state", "subject"])) {
    throw new WorkspaceCredentialError();
  }
  const { cookie, origin, subject } = payload;
  if (
    typeof cookie !== "string"
    || cookie.trim() === ""
    || /[\r\n]/.test(cookie)
    || typeof origin !== "string"
    || normalizeOrigin(origin) !== origin
    || exposesSecret(origin, cookie)
    || !isExactRecord(subject, ["id", "name"])
    || typeof subject.id !== "string"
    || subject.id.trim() === ""
    || typeof subject.name !== "string"
    || subject.name.trim() === ""
    || subjectExposesSecrets({ id: subject.id, name: subject.name }, [cookie])
  ) {
    throw new WorkspaceCredentialError();
  }
  return { state: "authenticated", cookie, origin, subject: { id: subject.id, name: subject.name } };
}

function normalizeOrigin(origin: string): string {
  try {
    return new WorkspaceHttp({ origin, role: "client" }).origin;
  } catch {
    throw new WorkspaceCredentialError();
  }
}

function exposesSecret(value: string, secret: string): boolean {
  if (value.includes(secret)) return true;
  try {
    return decodeURIComponent(value).includes(secret);
  } catch {
    return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, keys);
}
