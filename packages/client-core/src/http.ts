import { workspaceError } from "./errors.js";

export interface WorkspaceHttpOptions {
  readonly cookie?: string;
  readonly fetcher?: typeof fetch;
  readonly origin: string;
  readonly role: "client" | "worker";
}

export type AuthenticatedWorkspaceHttp = (signal?: AbortSignal) => Promise<WorkspaceHttp>;

export interface WorkspaceRequestOptions {
  readonly authenticated?: boolean;
  readonly body?: unknown;
  readonly contentLength?: number;
  readonly contentType?: string;
  readonly idempotencyKey?: string;
  readonly method?: string;
  readonly formBody?: FormData;
  readonly signal?: AbortSignal;
  readonly streamBody?: AsyncIterable<Uint8Array>;
}

export class WorkspaceHttp {
  public readonly origin: string;
  private readonly cookie: string | undefined;
  private readonly fetcher: typeof fetch;
  private readonly role: "client" | "worker";

  public constructor(options: WorkspaceHttpOptions) {
    this.origin = normalizeOrigin(options.origin);
    this.cookie = options.cookie;
    this.fetcher = options.fetcher ?? fetch;
    this.role = options.role;
  }

  public async json(
    path: string,
    options: WorkspaceRequestOptions = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.request(path, options);
    return await readWorkspaceJsonResponse(response);
  }

  public async request(path: string, options: WorkspaceRequestOptions = {}): Promise<Response> {
    const url = new URL(path, this.origin);
    if (url.username !== "" || url.password !== "" || url.origin !== this.origin) {
      throw workspaceError(
        "workspace-origin-mismatch",
        "Refusing a cross-origin Workspace request.",
      );
    }
    const authenticated = options.authenticated !== false;
    if (authenticated && (this.cookie === undefined || this.cookie.trim() === "")) {
      throw workspaceError("workspace-authentication-required", "Workspace Session is missing.");
    }
    if (
      [options.body, options.streamBody, options.formBody].filter((value) => value !== undefined)
        .length > 1
    ) {
      throw workspaceError(
        "workspace-request-invalid",
        "Workspace request cannot contain multiple body representations.",
      );
    }
    const method = options.method ?? "GET";
    let response: Response;
    try {
      const request: RequestInit & { duplex?: "half" } = {
        headers: {
          ...(authenticated ? { cookie: this.cookie! } : {}),
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(options.contentType === undefined ? {} : { "content-type": options.contentType }),
          ...(options.contentLength === undefined
            ? {}
            : { "content-length": String(options.contentLength) }),
          ...(options.idempotencyKey === undefined
            ? {}
            : { "idempotency-key": options.idempotencyKey }),
          ...(method === "GET" || method === "HEAD" ? {} : { origin: this.origin }),
          "x-univer-cli-sdk-role": this.role,
          ...(this.role === "worker" ? { "x-univer-cli-sdk-worker-pid": String(process.pid) } : {}),
        },
        method,
        redirect: "manual",
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.formBody === undefined ? {} : { body: options.formBody }),
        ...(options.streamBody === undefined
          ? {}
          : { body: streamBody(options.streamBody), duplex: "half" }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      };
      response = await this.fetcher(url, request);
    } catch (error) {
      throw workspaceError(
        "workspace-result-unknown",
        "The Workspace request result is unknown because the network request failed.",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    if (response.status >= 300 && response.status < 400) {
      throw workspaceError("workspace-redirect-refused", "Workspace redirects are not followed.");
    }
    if (authenticated && response.status === 401) {
      throw workspaceError(
        "workspace-authentication-required",
        "Workspace Session is missing or expired.",
        { path: url.pathname, status: response.status },
      );
    }
    if (!response.ok) {
      const body = await readOptionalJson(response);
      const error = isRecord(body?.["error"]) ? body["error"] : undefined;
      throw workspaceError(
        typeof error?.["code"] === "string" || typeof error?.["code"] === "number"
          ? String(error["code"])
          : `HTTP_${String(response.status)}`,
        typeof error?.["message"] === "string"
          ? error["message"]
          : `Workspace request failed with HTTP ${String(response.status)}.`,
        { status: response.status, path: url.pathname },
      );
    }
    return response;
  }

  /** Authenticated fetch-compatible transport for the Collaboration server adapter. */
  public async collaborationRequest(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    if (this.cookie === undefined || this.cookie.trim() === "") {
      throw workspaceError("workspace-authentication-required", "Workspace Session is missing.");
    }
    let request: Request;
    try {
      request = new Request(input, init);
    } catch (error) {
      throw workspaceError("workspace-request-invalid", "Workspace request is invalid.", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    const url = new URL(request.url);
    if (url.origin !== this.origin) {
      throw workspaceError(
        "workspace-origin-mismatch",
        "Refusing a cross-origin Workspace request.",
      );
    }
    const headers = new Headers(request.headers);
    headers.set("cookie", this.cookie);
    headers.set("x-univer-cli-sdk-role", this.role);
    if (this.role === "worker") {
      headers.set("x-univer-cli-sdk-worker-pid", String(process.pid));
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("origin", this.origin);
    }
    let response: Response;
    try {
      response = await this.fetcher(new Request(request, { headers, redirect: "manual" }));
    } catch (error) {
      throw workspaceError(
        "workspace-result-unknown",
        "The Workspace request result is unknown because the network request failed.",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    if (response.status >= 300 && response.status < 400) {
      throw workspaceError("workspace-redirect-refused", "Workspace redirects are not followed.");
    }
    return response;
  }

  public async content(url: URL, signal?: AbortSignal): Promise<Response> {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw responseError("Workspace Asset content URL must use HTTP(S).");
    }
    if (url.username !== "" || url.password !== "") {
      throw responseError("Workspace Asset content URL must not contain credentials.");
    }
    const sameOrigin = url.origin === this.origin;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: sameOrigin ? { cookie: this.cookie! } : {},
        method: "GET",
        redirect: "manual",
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      throw workspaceError(
        "workspace-result-unknown",
        "The Workspace Asset download result is unknown because the network request failed.",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    if (response.status >= 300 && response.status < 400) {
      throw workspaceError(
        "workspace-redirect-refused",
        "Workspace Asset download redirects are not followed.",
      );
    }
    if (sameOrigin && response.status === 401) {
      throw workspaceError(
        "workspace-authentication-required",
        "Workspace Session is missing or expired.",
        { status: response.status },
      );
    }
    if (!response.ok) {
      throw workspaceError(
        `HTTP_${String(response.status)}`,
        `Workspace Asset download failed with HTTP ${String(response.status)}.`,
        { status: response.status },
      );
    }
    return response;
  }
}

export function isWorkspaceRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw workspaceError("workspace-origin-invalid", "Workspace origin is invalid.");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw workspaceError(
      "workspace-origin-invalid",
      "Workspace origin must be an HTTP(S) origin without credentials, path, query, or fragment.",
    );
  }
  return url.origin;
}

async function readOptionalJson(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const value = (await response.json()) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function readWorkspaceJsonResponse(
  response: Response,
): Promise<Record<string, unknown>> {
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
  if (!isRecord(value)) throw responseError("Workspace returned a non-object JSON payload.");
  return value;
}

function streamBody(content: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = content[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async cancel(): Promise<void> {
      await iterator.return?.();
    },
    async pull(controller): Promise<void> {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function responseError(message: string): Error {
  return workspaceError("workspace-invalid-response", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
