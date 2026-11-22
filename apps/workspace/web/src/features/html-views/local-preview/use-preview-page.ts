import { useCallback, useEffect, useRef, useState } from "react";
import { sha256Hex } from "./report";
import type { PreviewSearch } from "./source";
import { resolveWorkspaceMedia } from "../workspace-media";

export interface PreviewPage {
  html: string;
  sha256: string;
  name: string;
  /** Changes only when the content does, so an unchanged save does not remount the page. */
  generation: number;
}

export type PreviewLoad =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; page: PreviewPage }
  | { status: "error"; kind: "blocked" | "refused" | "failed"; message: string; httpStatus?: number };

interface FileHandleLike { getFile(): Promise<File> }
type FilePicker = (options: { types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileHandleLike[]>;
interface DroppedItem { getAsFileSystemHandle?: () => Promise<FileHandleLike | null> }
interface PickedFile { file: File; handle?: FileHandleLike }

class HostRefused extends Error {
  constructor(readonly httpStatus: number) { super(`HTTP ${httpStatus}`); }
}

const FILE_POLL_MS = 500;
// Set once a loopback fetch succeeded. The browser then keeps the grant, so later loads may start without a click.
const GRANTED_KEY = "html-view-preview-loopback-granted";
const granted = () => { try { return localStorage.getItem(GRANTED_KEY) === "1"; } catch { return false; } };
const isStaleFileError = (error: unknown) => error instanceof DOMException && (error.name === "NotReadableError" || error.name === "NotFoundError");
const setGranted = (value: boolean) => { try { if (value) localStorage.setItem(GRANTED_KEY, "1"); else localStorage.removeItem(GRANTED_KEY); } catch { /* a blocked store only means a click next time */ } };

/** The page the user is previewing: the local host's file, or a file picked or dropped in the browser. */
export function usePreviewPage(search: PreviewSearch) {
  // Chrome shows its local-network prompt only for a request that follows a user gesture, so the first fetch waits for a click.
  const [attempt, setAttempt] = useState(() => (granted() ? 1 : 0));
  const [state, setState] = useState<PreviewLoad>({ status: attempt ? "loading" : "idle" });
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [stale, setStale] = useState(false);
  const generation = useRef(0);
  const hasPicker = typeof window !== "undefined" && "showOpenFilePicker" in window;

  const commit = useCallback(async (name: string, bytes: ArrayBuffer, signal: AbortSignal) => {
    const sha256 = await sha256Hex(bytes);
    const html = await resolveWorkspaceMedia(new TextDecoder().decode(bytes), window.location.origin, signal);
    if (signal.aborted) return;
    setState((current) => current.status === "ready" && current.page.sha256 === sha256 ? current
      : { status: "ready", page: { html, sha256, name, generation: ++generation.current } });
  }, []);

  useEffect(() => {
    if (picked || !search.src || !search.token || attempt === 0) return;
    const abort = new AbortController();
    const url = (path?: string) => {
      const target = new URL(path ?? search.src!, search.src);
      target.searchParams.set("token", search.token!);
      return target;
    };
    const load = async () => {
      try {
        const response = await fetch(url(), { credentials: "omit", redirect: "error", cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new HostRefused(response.status);
        await commit(search.file ?? "page.html", await response.arrayBuffer(), abort.signal);
        setGranted(true);
      } catch (error) {
        if (error instanceof TypeError) setGranted(false);
        if (abort.signal.aborted) return;
        // A failed refresh keeps the last good page; only a first load shows the error.
        setState((current) => current.status === "ready" ? current
          : error instanceof HostRefused ? { status: "error", kind: "refused", message: error.message, httpStatus: error.httpStatus }
          : error instanceof TypeError ? { status: "error", kind: "blocked", message: error.message }
          : { status: "error", kind: "failed", message: error instanceof Error ? error.message : String(error) });
      }
    };
    setState({ status: "loading" });
    const events = new EventSource(url("/events"));
    events.addEventListener("change", () => { void load(); });
    // Reconnecting also picks up saves made while the host was unreachable.
    events.addEventListener("open", () => { void load(); });
    void load();
    return () => { abort.abort(); events.close(); };
  }, [search.src, search.token, search.file, picked, attempt, commit]);

  useEffect(() => {
    if (!picked) return;
    const abort = new AbortController();
    let seen = "";
    const load = async () => {
      try {
        const file = (await picked.handle?.getFile()) ?? picked.file;
        const version = `${file.lastModified}:${file.size}`;
        if (version === seen) return;
        seen = version;
        await commit(file.name, await file.arrayBuffer(), abort.signal);
      } catch (error) {
        if (!picked.handle && isStaleFileError(error)) setStale(true);
        if (!abort.signal.aborted) setState((current) => current.status === "ready" ? current
          : { status: "error", kind: "failed", message: error instanceof Error ? error.message : String(error) });
      }
    };
    setState({ status: "loading" });
    setStale(false);
    void load();
    // A File from an input or a drop is a snapshot: after the disk changes, Chrome throws NotReadableError and Safari NotFoundError.
    const timer = setInterval(() => {
      if (picked.handle) void load();
      else picked.file.slice(0, 1).arrayBuffer().catch((error: unknown) => { if (isStaleFileError(error)) setStale(true); });
    }, FILE_POLL_MS);
    return () => { abort.abort(); clearInterval(timer); };
  }, [picked, commit]);

  return {
    state,
    isFile: picked !== null,
    watching: picked?.handle !== undefined,
    stale,
    /** Must run inside a click handler. */
    start() { setAttempt((n) => n + 1); },
    /** A picker that keeps the file handle where the browser has one, so changes reload. */
    async choose(): Promise<boolean> {
      if (!hasPicker) return false;
      try {
        const [handle] = await (window as unknown as { showOpenFilePicker: FilePicker }).showOpenFilePicker({
          types: [{ description: "HTML", accept: { "text/html": [".html", ".htm"] } }],
        });
        if (handle) setPicked({ handle, file: await handle.getFile() });
      } catch { /* dismissing the picker is not an error */ }
      return true;
    },
    pickInput(file: File | undefined) { if (file) setPicked({ file }); },
    async drop(items: DataTransferItemList, files: FileList) {
      // The drop data is only readable before the first await.
      const file = files[0];
      const handle = await (items[0] as unknown as DroppedItem | undefined)?.getAsFileSystemHandle?.();
      if (handle && "getFile" in handle) setPicked({ handle, file: await handle.getFile() });
      else if (file) setPicked({ file });
    },
  };
}
