/**
 * Polls per-document collaboration state for a stable list of resource ids —
 * port of the dsh-univer-office useUniverStates hook against the plugin's
 * file-state endpoint.
 * @module dsh-univer-workspace-plugin/client/hooks/use-univer-state
 */

import * as React from "react";
import type { DocumentFileState } from "../../shared/state.ts";
import { getFileState, isMissingDocument } from "../api/univer-api.ts";

/** Poll collaboration state for a stable list of docKeys (`res:`/`wt:`). */
export function useUniverStates(files: readonly string[], intervalMs = 900): {
  readonly states: Readonly<Record<string, DocumentFileState>>;
  readonly missingFiles: ReadonlySet<string>;
  /** Non-404 transport/server failures keyed by document identity. */
  readonly errors: Readonly<Record<string, string>>;
} {
  const [states, setStates] = React.useState<Record<string, DocumentFileState>>({});
  const [missing, setMissing] = React.useState<Record<string, true>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const key = files.join("\u0000");
  React.useEffect(() => {
    if (key === "") {
      setStates({});
      setMissing({});
      setErrors({});
      return;
    }
    const trackedFiles = key.split("\u0000");
    setStates({});
    setMissing({});
    setErrors({});
    let active = true;
    let pollInFlight = false;
    let activeController: AbortController | undefined;
    const poll = async (): Promise<void> => {
      // A slow file-state response must not cause the interval to pile up
      // another request.  In production this used to leave a growing set of
      // pending requests and made the Viewer appear to load forever.
      if (!active || pollInFlight) return;
      pollInFlight = true;
      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        for (const file of trackedFiles) {
          try {
            const state = await getFileState(file, controller.signal);
            if (!active) return;
            setStates((previous) => ({ ...previous, [file]: state }));
            setMissing((previous) => {
              if (previous[file] === undefined) return previous;
              const next = { ...previous };
              delete next[file];
              return next;
            });
            setErrors((previous) => {
              if (previous[file] === undefined) return previous;
              const next = { ...previous };
              delete next[file];
              return next;
            });
          } catch (error) {
            if (!active) return;
            if (isMissingDocument(error)) {
              setStates((previous) => {
                if (previous[file] === undefined) return previous;
                const next = { ...previous };
                delete next[file];
                return next;
              });
              setMissing((previous) => previous[file] === true ? previous : { ...previous, [file]: true });
            } else if (!(error instanceof DOMException && error.name === "AbortError")) {
              setErrors((previous) => ({ ...previous, [file]: errorMessage(error) }));
            }
          }
        }
      } finally {
        window.clearTimeout(timeout);
        if (activeController === controller) activeController = undefined;
        pollInFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), intervalMs);
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      activeController?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [key, intervalMs]);
  return { states, missingFiles: new Set(Object.keys(missing)), errors };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  if (typeof error === "string" && error !== "") return error;
  return "file state request failed";
}
