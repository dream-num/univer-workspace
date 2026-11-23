export interface PreviewSearch {
  /** The local preview host's page URL; absent when the user picks a file. */
  src?: string;
  token?: string;
  /** Display name only; the host decides what it serves. */
  file?: string;
  repo?: string;
  pr?: number;
}

const LOOPBACK_SRC = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9]\d{0,4})(?:[/?#]|$)/;
const TOKEN = /^[\w-]{16,128}$/;

export class PreviewSourceError extends Error {}

/** Route search validation. Anything that is not a plain loopback HTTP host with a pairing token is refused. */
export function parsePreviewSearch(search: Record<string, unknown>): PreviewSearch {
  const repo = typeof search.repo === "string" ? search.repo : undefined;
  const pr = search.pr === undefined ? undefined : Number(search.pr);
  if ((repo === undefined) !== (pr === undefined) || (repo !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(repo)) ||
      (pr !== undefined && (!Number.isSafeInteger(pr) || pr < 1)))
    throw new PreviewSourceError("Provide repo=owner/slug and a positive pr together.");
  const common = { ...(repo !== undefined && pr !== undefined ? { repo, pr } : {}),
    ...(search.file === undefined ? {} : { file: String(search.file).slice(0, 200) }) };
  if (search.src === undefined) {
    if (search.token !== undefined) throw new PreviewSourceError("token needs a src.");
    return common;
  }
  const match = typeof search.src === "string" ? LOOPBACK_SRC.exec(search.src) : null;
  if (typeof search.src !== "string" || !match || Number(match[1]) > 65535) throw new PreviewSourceError("src must be an HTTP loopback URL with an explicit port.");
  const src = new URL(search.src);
  if (src.username || src.password || src.search || src.hash) throw new PreviewSourceError("Loopback source refused.");
  if (typeof search.token !== "string" || !TOKEN.test(search.token)) throw new PreviewSourceError("A valid token is required with src.");
  return { ...common, src: src.href, token: search.token };
}
