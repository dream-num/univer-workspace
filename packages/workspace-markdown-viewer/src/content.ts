export function isMarkdownFile(filename: string, mediaType: string): boolean {
  const mime = mediaType.split(";", 1)[0]!.trim().toLowerCase();
  if (mime === "text/markdown" || mime === "text/x-markdown") return true;
  // Older uploads may have been classified as octet-stream when an UTF-8
  // character straddled the detector's sample boundary. Validate bytes below.
  return (
    /\.(md|markdown)$/i.test(filename) &&
    (mime.startsWith("text/") || mime === "application/octet-stream")
  );
}

/** Decode the complete file; the host owns fetch, authentication and cancellation. */
export async function readMarkdownContent(response: Response): Promise<string> {
  if (!response.ok || response.status === 206 || !response.body) {
    throw new Error("Markdown content is unavailable");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer());
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw new Error("Markdown content is not text");
  }
  return text;
}

/** Explicit protocols only: relative URLs belong to the host's future path resolver. */
export function markdownUrl(value: string, image = false): string {
  const url = value.trim();
  if (/[\u0000-\u0020\u007f]/u.test(url)) return "";
  if (!image && url.startsWith("#")) return url;
  if (!/^https?:\/\//i.test(url) && !(!image && /^mailto:/i.test(url))) return "";
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return "";
    return url;
  } catch {
    return "";
  }
}
