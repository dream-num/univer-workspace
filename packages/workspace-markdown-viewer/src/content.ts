export const MARKDOWN_PREVIEW_BYTES = 256 * 1024;

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

export interface MarkdownContent {
  readonly text: string;
  readonly truncated: boolean;
}

/** Decode a bounded response; the host owns fetch, authentication and cancellation. */
export async function readMarkdownContent(response: Response): Promise<MarkdownContent> {
  if (!response.ok || !response.body) throw new Error("Markdown content is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    // Read one extra byte to detect oversized bodies even if a server ignores Range.
    while (length <= MARKDOWN_PREVIEW_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, MARKDOWN_PREVIEW_BYTES + 1 - length);
      chunks.push(chunk);
      length += chunk.length;
    }
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
  const range = response.headers.get("content-range");
  let partial = false;
  if (response.status === 206) {
    const match = /^bytes 0-(\d+)\/(\d+|\*)$/i.exec(range ?? "");
    if (!match || Number(match[1]) + 1 !== length) throw new Error("Invalid Markdown range");
    partial = match[2] === "*" || Number(match[2]) > length;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const truncated = partial || length > MARKDOWN_PREVIEW_BYTES;
  // A prefix may end inside a multibyte character. In streaming mode the decoder
  // retains that incomplete tail, while still rejecting invalid bytes inside it.
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(0, MARKDOWN_PREVIEW_BYTES),
    { stream: truncated },
  );
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw new Error("Markdown content is not text");
  }
  return { text, truncated };
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
