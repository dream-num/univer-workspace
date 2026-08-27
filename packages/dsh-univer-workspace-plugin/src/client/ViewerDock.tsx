/**
 * The floating viewer dock: a session-scoped dock that reads the viewer open
 * intents projected from `univer_open` tool results and renders one floating
 * Univer collaboration editor window per opened document.
 * @module dsh-univer-workspace-plugin/client/ViewerDock
 */

import { useEffect, useMemo, useState } from "react";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { CollaborationViewer } from "./collaboration-viewer.tsx";
import { sheetViewerDefinition } from "./viewer-sheet.ts";
import type { ViewerDefinition } from "./collaboration-viewer.tsx";
import type { ViewerOpenIntent } from "./viewer-turn-definition.ts";

/** The injected business face supplied by the client apply closure. */
export interface ViewerDockInjected {
  readonly loadViewerBootstrap: () => Promise<ViewerBootstrap>;
}

export interface ViewerBootstrap {
  readonly user: { readonly id: string; readonly displayName: string; readonly avatarUrl: string | null };
  readonly license: string;
}

export type ViewerDockProps = PropsRuntime<"conversation.input.dock"> & ViewerDockInjected;

const DEFINITIONS: Record<ViewerOpenIntent["unitType"], ViewerDefinition | undefined> = {
  sheet: sheetViewerDefinition,
  // doc/slide/board/base definitions arrive with their preset packages.
  doc: undefined,
  slide: undefined,
  board: undefined,
  base: undefined,
};

/** Read the viewer open intents for this session's completed Turns. */
function openIntentsOf(session: unknown): readonly ViewerOpenIntent[] {
  if (session === null || typeof session !== "object") return [];
  const snapshot = session as { chat?: { timeline?: { turns?: ReadonlyMap<number, { data: ReadonlyMap<string, unknown> }> } } };
  const turns = snapshot.chat?.timeline?.turns;
  if (turns === undefined) return [];
  const intents: ViewerOpenIntent[] = [];
  for (const turn of turns.values()) {
    const data = turn.data.get("univerViewer") as { intents?: readonly ViewerOpenIntent[] } | undefined;
    if (data === undefined || data.intents === undefined) continue;
    for (const intent of data.intents) {
      if (!intents.some((entry) => entry.unitId === intent.unitId)) intents.push(intent);
    }
  }
  return intents;
}

/** The floating viewer dock. */
export function ViewerDock(props: ViewerDockProps) {
  // `session` arrives through the input-region owner share as a point-in-time
  // ConversationSnapshot; the skeleton re-renders dock entries on every store
  // change, so the intents derivation needs no separate subscription.
  const intents = useMemo(() => openIntentsOf(props.session), [props.session]);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [bootstrap, setBootstrap] = useState<ViewerBootstrap | null>(null);

  useEffect(() => {
    let live = true;
    void props.loadViewerBootstrap()
      .then((value) => {
        if (live) setBootstrap(value);
      })
      .catch((reason: unknown) => {
        console.error("univer-workspace viewer bootstrap failed", reason);
      });
    return () => { live = false; };
  }, [props.loadViewerBootstrap]);

  const visible = intents.filter((intent) => !dismissed.includes(intent.unitId));

  if (bootstrap === null || visible.length === 0) return null;

  return (
    <div className="uws-viewer-dock">
      {visible.map((intent) => {
        const definition = DEFINITIONS[intent.unitType];
        if (definition === undefined) return null;
        return (
          <section key={intent.unitId} className="uws-viewer-window" aria-label={intent.name}>
            <header className="uws-viewer-header">
              <span className="uws-viewer-title">{intent.name}</span>
              <span className="uws-viewer-meta">{intent.unitType}{intent.readOnly ? " · 只读" : ""}</span>
              <button
                type="button"
                className="uws-viewer-close"
                aria-label="关闭"
                onClick={() => setDismissed((previous) => [...previous, intent.unitId])}
              >
                ×
              </button>
            </header>
            <div className="uws-viewer-body">
              <CollaborationViewer
                unitId={intent.unitId}
                unitType={intent.unitType}
                readOnly={intent.readOnly}
                user={bootstrap.user}
                license={bootstrap.license}
                locale="zh-CN"
                definition={definition}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
