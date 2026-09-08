import type { ReferenceInsert } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { InputTriggerSource } from "@deepseek-ai/dsh-client-ui-input-trigger/client";

export const LOCAL_REFERENCE_SOURCE = "univer-workspace-local-path";
export type PathReference =
  | { kind: "workspace-folder"; nodeId: string; spaceId: string; name: string }
  | { kind: "local-file" | "local-folder"; path: string; name: string };

export function decodePathReference(raw: string): PathReference {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (!value || typeof value.name !== "string" || !value.name)
    throw new Error("Invalid path reference");
  if (
    value.kind === "workspace-folder" &&
    typeof value.nodeId === "string" &&
    value.nodeId &&
    typeof value.spaceId === "string" &&
    value.spaceId
  ) {
    return { kind: value.kind, nodeId: value.nodeId, spaceId: value.spaceId, name: value.name };
  }
  if (
    (value.kind === "local-file" || value.kind === "local-folder") &&
    typeof value.path === "string" &&
    value.path &&
    !value.path.includes("\0")
  ) {
    return { kind: value.kind, path: value.path, name: value.name };
  }
  throw new Error("Invalid path reference");
}

function encodeIdentity(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** URL metadata is display-only; serialization resolves the authoritative target. */
export function pathReferenceUrl(value: PathReference): string {
  return value.kind === "workspace-folder"
    ? `univer-workspace-folder:${encodeIdentity(value.nodeId)}?spaceId=${encodeIdentity(value.spaceId)}`
    : `univer-local-path:${encodeIdentity(value.path)}?kind=${value.kind === "local-folder" ? "folder" : "file"}`;
}

export function pathReferenceFromUrl(url: string, name: string): PathReference | undefined {
  try {
    const parsed = new URL(url);
    const id = decodeURIComponent(parsed.pathname);
    if (parsed.protocol === "univer-workspace-folder:")
      return decodePathReference(
        JSON.stringify({
          kind: "workspace-folder",
          nodeId: id,
          spaceId: parsed.searchParams.get("spaceId"),
          name,
        }),
      );
    if (
      parsed.protocol === "univer-local-path:" &&
      ["file", "folder"].includes(parsed.searchParams.get("kind") ?? "")
    )
      return decodePathReference(
        JSON.stringify({
          kind: parsed.searchParams.get("kind") === "folder" ? "local-folder" : "local-file",
          path: id,
          name,
        }),
      );
  } catch {
    /* Historical malformed links stay plain text. */
  }
  return undefined;
}

export function pathReferenceText(value: PathReference): string {
  const label = value.name.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
  return `@[${label}](${pathReferenceUrl(value)})`;
}

export function pathReferenceInsert(
  value: PathReference,
  source = LOCAL_REFERENCE_SOURCE,
): ReferenceInsert {
  return {
    source,
    ref: JSON.stringify(value),
    label: value.name,
    appearance: value.kind === "local-file" ? "file" : "folder",
    clipboardText: pathReferenceText(value),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid reference response");
  return value as Record<string, unknown>;
}

async function request(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(`/univer-workspace/api${path}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Referenced file or folder is unavailable");
  return object(await response.json());
}

/** A mention never grants access or embeds directory contents into the prompt. */
export async function resolvePathReference(
  value: PathReference,
  signal: AbortSignal,
): Promise<PathReference> {
  if (value.kind === "workspace-folder") {
    const result = await request(`/nodes/${encodeIdentity(value.nodeId)}`, signal);
    const node = object(result.node);
    if (
      node?.id !== value.nodeId ||
      node.spaceId !== value.spaceId ||
      node.resource !== null ||
      typeof node.name !== "string"
    )
      throw new Error("Referenced Workspace folder is unavailable");
    return { ...value, name: node.name };
  }
  const result = await request(
    `/local-files?action=resolve&path=${encodeIdentity(value.path)}`,
    signal,
  );
  if (
    result.kind !== (value.kind === "local-folder" ? "folder" : "file") ||
    typeof result.path !== "string" ||
    typeof result.name !== "string"
  )
    throw new Error("Referenced local path changed type or is unavailable");
  return { ...value, path: result.path, name: result.name };
}

export function createLocalPathInputSource(labels: {
  localFiles: string;
  host: string;
  truncated: string;
}): InputTriggerSource {
  return {
    trigger: "@",
    name: LOCAL_REFERENCE_SOURCE,
    order: 60,
    showGroupTitle: false,
    async candidates(_session, { query, signal }) {
      if (query === "" || query.toLowerCase() === "local" || query === labels.localFiles)
        return [
          {
            name: labels.localFiles,
            description: labels.host,
            icon: "folder",
            drill: true,
            value: JSON.stringify({ browse: "~" }),
          },
        ];
      const path = query.startsWith("local:")
        ? query.slice(6)
        : /^(?:\/|~(?:\/|$)|[A-Za-z]:[\\/])/.test(query)
          ? query
          : undefined;
      if (path === undefined) return [];
      await settleTyping(signal);
      const page = await request(`/local-files?path=${encodeURIComponent(path || "~")}`, signal);
      if (
        !Array.isArray(page.entries) ||
        typeof page.directory !== "string" ||
        typeof page.parent !== "string"
      )
        throw new Error("Invalid local directory response");
      const entries = page.entries.map((raw: unknown) => {
        const entry = object(raw);
        if (entry.kind !== "file" && entry.kind !== "folder")
          throw new Error("Invalid local file type");
        const value = decodePathReference(
          JSON.stringify({
            kind: entry.kind === "folder" ? "local-folder" : "local-file",
            path: entry.path,
            name: entry.name,
          }),
        );
        return {
          name: value.name,
          description: "path" in value ? value.path : "",
          icon: entry.kind === "folder" ? ("folder" as const) : ("file" as const),
          drill: entry.kind === "folder",
          value: JSON.stringify(value),
        };
      });
      return [
        {
          name: page.directory,
          description: page.truncated || entries.length > 50 ? labels.truncated : labels.host,
          icon: "folder",
          drill: true,
          value: JSON.stringify({
            kind: "local-folder",
            path: page.directory,
            name: page.directory,
          }),
        },
        ...(page.parent === page.directory
          ? []
          : [
              {
                name: "..",
                description: page.parent,
                icon: "folder" as const,
                drill: true,
                value: JSON.stringify({ browse: page.parent }),
              },
            ]),
        ...entries.slice(0, 50),
      ];
    },
    onPick({ candidate, action }) {
      if (!candidate.value) return undefined;
      const raw = JSON.parse(candidate.value);
      if (typeof raw.browse === "string") return localDrill(raw.browse);
      const value = decodePathReference(candidate.value);
      if (action === "drill" && value.kind === "local-folder") return localDrill(value.path);
      return { insert: pathReferenceInsert(value) };
    },
    codec: {
      clipboardText: (ref) => pathReferenceText(decodePathReference(ref)),
      serialize: async (ref, signal) =>
        JSON.stringify(await resolvePathReference(decodePathReference(ref), signal)),
    },
  };
}

function localDrill(path: string): { text: string; continue: true } {
  const query = `local:${path.replace(/[\\/]$/, "")}/`;
  return { text: /\s/.test(query) ? `@"${query}` : `@${query}`, continue: true };
}

/** Cancel superseded keystrokes before touching the host filesystem. */
function settleTyping(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 150);
    signal.addEventListener("abort", abort, { once: true });
  });
}
