import { workspaceError } from "./errors.js";
import {
  isWorkspaceRecord,
  readWorkspaceJsonResponse,
  WorkspaceHttp,
} from "./http.js";

export interface WorkspaceSubject {
  readonly id: string;
  readonly name: string;
}

export interface WorkspaceAuthentication {
  readonly cookie: string;
  readonly origin: string;
  readonly subject: WorkspaceSubject;
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
  | ({ readonly status: "authenticated" } & WorkspaceAuthentication);

export async function loginWithPassword(
  http: WorkspaceHttp,
  input: { readonly password: string; readonly username: string },
): Promise<WorkspaceAuthentication> {
  const response = await http.request("/api/auth/password/login", {
    authenticated: false,
    body: input,
    method: "POST",
  });
  return authenticationFromResponse(http.origin, response, "Login");
}

export async function startCliLogin(
  http: WorkspaceHttp,
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<PendingCliLogin> {
  const response = await http.request("/api/auth/cli/authorizations", {
    authenticated: false,
    method: "POST",
    ...(signal === undefined ? {} : { signal }),
  });
  const body = await readWorkspaceJsonResponse(response);
  const deviceCode = requiredString(body["deviceCode"], "deviceCode");
  const userCode = requiredString(body["userCode"], "userCode");
  const verificationUriComplete = requiredString(
    body["verificationUriComplete"],
    "verificationUriComplete",
  );
  const expiresIn = requiredPositiveInteger(body["expiresIn"], "expiresIn");
  requiredPositiveInteger(body["interval"], "interval");
  let verificationUrl: URL;
  try {
    verificationUrl = new URL(verificationUriComplete, http.origin);
  } catch {
    throw responseError("CLI login verification URL is invalid or cross-origin.");
  }
  if (
    verificationUrl.origin !== http.origin ||
    verificationUrl.username !== "" ||
    verificationUrl.password !== ""
  ) {
    throw responseError("CLI login verification URL is invalid or cross-origin.");
  }
  const expiresAt = now() + expiresIn * 1000;
  if (!Number.isFinite(expiresAt)) {
    throw responseError("CLI login response contains an invalid expiresIn.");
  }
  return {
    deviceCode,
    expiresAt,
    origin: http.origin,
    userCode,
    verificationUrl: verificationUrl.href,
  };
}

export async function completeCliLogin(
  http: WorkspaceHttp,
  pending: PendingCliLogin,
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<CliLoginCompletion> {
  if (now() >= pending.expiresAt) {
    throw workspaceError(
      "workspace-cli-authorization-expired",
      "The browser login request expired. Run login again.",
    );
  }
  if (http.origin !== pending.origin) {
    throw workspaceError(
      "workspace-origin-mismatch",
      "Refusing a cross-origin Workspace request.",
    );
  }
  const response = await http.request("/api/auth/cli/authorizations/exchange", {
    authenticated: false,
    body: { deviceCode: pending.deviceCode },
    method: "POST",
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 202) {
    const body = await readWorkspaceJsonResponse(response);
    if (body["status"] !== "pending") {
      throw responseError("CLI login completion response is invalid.");
    }
    return { status: "pending" };
  }
  return {
    status: "authenticated",
    ...(await authenticationFromResponse(http.origin, response, "CLI login")),
  };
}

export async function whoami(
  http: WorkspaceHttp,
  signal?: AbortSignal,
): Promise<{ readonly origin: string; readonly subject: WorkspaceSubject }> {
  const body = await http.json("/api/session", signal === undefined ? {} : { signal });
  if (body["authenticated"] !== true) {
    throw workspaceError(
      "workspace-authentication-required",
      "Workspace Session is missing or expired.",
    );
  }
  return { origin: http.origin, subject: parseSubject(body["user"]) };
}

export async function logout(
  http: WorkspaceHttp,
  signal?: AbortSignal,
): Promise<{ readonly loggedOut: true; readonly origin: string }> {
  await http.request("/api/auth/logout", {
    method: "POST",
    ...(signal === undefined ? {} : { signal }),
  });
  return { loggedOut: true, origin: http.origin };
}

async function authenticationFromResponse(
  origin: string,
  response: Response,
  label: "CLI login" | "Login",
): Promise<WorkspaceAuthentication> {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (cookie === undefined || cookie.length === 0) {
    throw responseError(`${label} response did not include a Session cookie.`);
  }
  const body = await readWorkspaceJsonResponse(response);
  if (body["authenticated"] !== true) {
    throw responseError(`${label} response is not an authenticated Session.`);
  }
  return { cookie, origin, subject: parseSubject(body["user"]) };
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

function responseError(message: string): Error {
  return workspaceError("workspace-invalid-response", message);
}
