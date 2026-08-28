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
} {
  const [states, setStates] = React.useState<Record<string, DocumentFileState>>({});
  const [missing, setMissing] = React.useState<Record<string, true>>({});
  const key = files.join("\u0000");
  React.useEffect(() => {
    if (key === "") {
      setStates({});
      setMissing({});
      return;
    }
    const trackedFiles = key.split("\u0000");
    setStates({});
    setMissing({});
    let active = true;
    const poll = async (): Promise<void> => {
      for (const file of trackedFiles) {
        try {
          const state = await getFileState(file);
          if (!active) return;
          setStates((previous) => ({ ...previous, [file]: state }));
          setMissing((previous) => {
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
          }
        }
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
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [key, intervalMs]);
  return { states, missingFiles: new Set(Object.keys(missing)) };
}
