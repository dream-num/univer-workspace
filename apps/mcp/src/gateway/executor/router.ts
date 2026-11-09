import { createHash } from "node:crypto";

export function rendezvous(urls: readonly string[], key: string): string[] {
  const score = (url: string) =>
    createHash("sha256").update(key).update("\0").update(url).digest("hex");
  return [...urls].sort((a, b) => score(b).localeCompare(score(a)));
}

export class ExecutorRouter {
  private readonly downUntil = new Map<string, number>();
  constructor(private urls: readonly string[]) {}
  setUrls(urls: readonly string[]): void {
    this.urls = urls;
  }
  candidates(key: string): string[] {
    const ordered = rendezvous(this.urls, key);
    const healthy = ordered.filter((url) => (this.downUntil.get(url) ?? 0) <= Date.now());
    return healthy.length ? healthy : ordered;
  }
  notDelivered(url: string): void {
    this.downUntil.set(url, Date.now() + 5_000);
  }
}

export function classifyFetchFailure(error: unknown): "not-delivered" | "unknown" {
  const codes = new Set([
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
  ]);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return cause instanceof Error &&
    "code" in cause &&
    typeof cause.code === "string" &&
    codes.has(cause.code)
    ? "not-delivered"
    : "unknown";
}
