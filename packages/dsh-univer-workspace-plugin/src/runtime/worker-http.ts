/**
 * The runtime HTTP transport: an authenticated, same-origin fetch facade over
 * one workspace session token. The worker builds this from the target token
 * instead of a session file.
 * @module dsh-univer-workspace-plugin/runtime/worker-http
 */

import type { WorkspaceRuntimeTarget } from "./target.js";

export class WorkerHttp {
  public readonly origin: string;

  public constructor(private readonly target: WorkspaceRuntimeTarget) {
    this.origin = new URL(target.origin).origin;
  }

  public async json(path: string): Promise<Record<string, unknown>> {
    const response = await this.request(path);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = body.replace(/\s+/gu, " ").trim().slice(0, 800);
      throw Object.assign(
        new Error(`workspace request failed: GET ${path} answered ${response.status}${detail === "" ? "" : `; response: ${detail}`}`),
        { code: `WORKSPACE_HTTP_${response.status}` },
      );
    }
    const value = (await response.json()) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("workspace returned a non-object JSON payload");
    }
    return value as Record<string, unknown>;
  }

  public async request(path: string, init?: RequestInit): Promise<Response> {
    return await this.collaborationRequest(new URL(path, this.origin), init);
  }

  public async collaborationRequest(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== this.origin) {
      throw new Error("refusing a cross-origin workspace request");
    }
    const headers = new Headers(request.headers);
    headers.set("cookie", `workspace_session=${this.target.sessionToken}`);
    headers.set("x-univer-cli-sdk-role", "worker");
    headers.set("x-univer-cli-sdk-worker-pid", String(process.pid));
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("origin", this.origin);
    }
    return await fetch(new Request(request, { headers, redirect: "manual" }));
  }
}
