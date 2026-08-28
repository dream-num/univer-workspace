/** Browser title projection for the Workspace Harness composition. */
import { useEffect, useSyncExternalStore } from "react";
import { formatHarnessDocumentTitle } from "./document-title.ts";

/** Minimal observable shape needed from the native session list. */
export interface HarnessSessionList {
  readonly getSnapshot: () => {
    readonly current: string | undefined;
    readonly byId: Readonly<Record<string, { readonly title?: string } | undefined>>;
  };
  readonly subscribe: (listener: () => void) => () => void;
}

/** Props for the root-scoped title projection. */
export interface HarnessDocumentTitleProps {
  readonly sessionList: HarnessSessionList;
}

/**
 * Keep the native session-title behavior while replacing only its product
 * suffix. The component is mounted in the frame-wide overlay slot, which is
 * additive and renders after the DSH renderer's own title projection.
 */
export function HarnessDocumentTitle({ sessionList }: HarnessDocumentTitleProps): null {
  const snapshot = useSyncExternalStore(
    listener => sessionList.subscribe(listener),
    () => sessionList.getSnapshot(),
    () => sessionList.getSnapshot(),
  );
  const current = snapshot.current;
  const sessionTitle = current === undefined ? undefined : snapshot.byId[current]?.title;
  const title = formatHarnessDocumentTitle(sessionTitle);

  // The stock renderer projects its title in a sibling passive effect before
  // the root slot is committed.  Use the same phase from the root-owned
  // projection so this composition's product suffix is the final writer while
  // retaining the native session-title update cadence.
  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
