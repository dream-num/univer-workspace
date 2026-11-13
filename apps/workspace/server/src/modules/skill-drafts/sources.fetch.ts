import { z } from "zod";
import { ApplicationError } from "../../middleware/errors.js";

const hosts = new Set(["api.github.com", "raw.githubusercontent.com", "clawhub.ai"]);
const ambiguousSchema = z.object({
  matches: z.array(z.object({ ownerHandle: z.string().max(255) })).max(100),
});
export type SourceFetch = typeof fetch;
export function createSourceFetch(options: { fetch?: SourceFetch; githubToken?: string }) {
  const fetcher = options.fetch ?? fetch;
  return async function read(urlValue: string, maxBytes: number): Promise<Buffer> {
    let url = new URL(urlValue);
    const signal = AbortSignal.timeout(15_000);
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        if (
          url.protocol !== "https:" ||
          !hosts.has(url.hostname) ||
          url.port ||
          url.username ||
          url.password
        )
          throw new ApplicationError(
            "SKILL_SOURCE_UNAVAILABLE",
            502,
            "Skill source redirected outside the allowed hub hosts.",
          );
        const response = await fetcher(url, {
          redirect: "manual",
          signal,
          headers: {
            "User-Agent": "Univer-Workspace-Skill-Import",
            ...(url.hostname === "api.github.com"
              ? {
                  Accept: "application/vnd.github+json",
                  ...(options.githubToken
                    ? { Authorization: `Bearer ${options.githubToken}` }
                    : {}),
                }
              : {}),
          },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get("location");
          if (!location) break;
          url = new URL(location, url);
          continue;
        }
        if (
          response.status === 429 ||
          (url.hostname === "api.github.com" && response.status === 403)
        ) {
          await response.body?.cancel();
          throw new ApplicationError(
            "SKILL_SOURCE_RATE_LIMITED",
            429,
            "Hub rate limit or access restriction. Ask the user to download the zip and upload it to Space, then use its node ID.",
          );
        }
        if (response.status === 409 && url.hostname === "clawhub.ai") {
          const parsed = ambiguousSchema.safeParse(
            JSON.parse((await readBounded(response, 64 * 1024)).toString("utf8")),
          );
          throw new ApplicationError(
            "SKILL_SOURCE_AMBIGUOUS",
            409,
            `ClawHub slug is ambiguous. Candidate owners: ${parsed.success ? parsed.data.matches.map((m) => m.ownerHandle).join(", ") : "unknown"}. Specify an owner handle.`,
          );
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new ApplicationError(
            response.status === 404 ? "NOT_FOUND" : "SKILL_SOURCE_UNAVAILABLE",
            response.status === 404 ? 404 : 502,
            `Skill source returned HTTP ${response.status}.`,
          );
        }
        return await readBounded(response, maxBytes);
      }
      throw new ApplicationError(
        "SKILL_SOURCE_UNAVAILABLE",
        502,
        "Too many Skill source redirects.",
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "SKILL_SOURCE_UNAVAILABLE",
        502,
        "Could not read Skill source within the request timeout.",
      );
    }
  };
}
async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new ApplicationError("PAYLOAD_TOO_LARGE", 413, "Source response exceeds its byte limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes)
        throw new ApplicationError(
          "PAYLOAD_TOO_LARGE",
          413,
          "Source response exceeds its byte limit.",
        );
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}
