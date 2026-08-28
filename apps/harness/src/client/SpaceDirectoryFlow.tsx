import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { UwhWorkspaceSpace } from "../contract.ts";
import type { HarnessLocaleKey } from "./locales.ts";

/** Public owner conversation of DSH's two Workspace directory-flow slots. */
export interface SpaceDirectoryFlowOwnerProps {
  readonly open: boolean;
  readonly busy: boolean;
  readonly onPicked: (path: string) => void;
  readonly onCancel: () => void;
  readonly onError: (message: string) => void;
}

export interface SpaceDirectoryFlowInjected {
  readonly loadSpaces: () => Promise<readonly UwhWorkspaceSpace[]>;
  readonly selectSpace: (dshWorkspaceId: string) => void;
  readonly t: (key: HarnessLocaleKey) => string;
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "conversation.hero.workspace.directoryFlow": {
      kind: "single";
      scope: "root";
      owner: SpaceDirectoryFlowOwnerProps;
    };
    "sidebar.workspaces.directoryFlow": {
      kind: "single";
      scope: "root";
      owner: SpaceDirectoryFlowOwnerProps;
    };
  }
}

type Phase = "pending" | "ready" | "error";

/** Product-Space picker replacing DSH's local filesystem directory chooser. */
export function SpaceDirectoryFlow(
  props: SpaceDirectoryFlowOwnerProps & SpaceDirectoryFlowInjected,
): ReactElement | null {
  const { open, busy, loadSpaces, onCancel, selectSpace, t } = props;
  const [phase, setPhase] = useState<Phase>("pending");
  const [spaces, setSpaces] = useState<readonly UwhWorkspaceSpace[]>([]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPhase("pending");
    void loadSpaces().then((value) => {
      if (!live) return;
      setSpaces(value);
      setPhase("ready");
    }).catch(() => {
      if (live) setPhase("error");
    });
    return () => { live = false; };
  }, [loadSpaces, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [busy, onCancel, open]);

  if (!open) return null;
  return (
    <div
      className="uwh-spacePickerBackdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="uwh-spacePickerDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="uwh-space-picker-title"
      >
        <header className="uwh-spacePickerHeader">
          <div>
            <h2 id="uwh-space-picker-title">{t("chooseSpace")}</h2>
            <p>{t("chooseSpaceHint")}</p>
          </div>
          <button
            type="button"
            className="uwh-spacePickerClose"
            aria-label={t("cancel")}
            disabled={busy}
            onClick={onCancel}
          >
            ×
          </button>
        </header>
        <div className="uwh-spacePickerBody">
          {phase === "pending" && <p className="uwh-spacePickerStatus" role="status">{t("loadingSpaces")}</p>}
          {phase === "error" && <p className="uwh-spacePickerError" role="alert">{t("spacesLoadFailed")}</p>}
          {phase === "ready" && spaces.length === 0 && <p className="uwh-spacePickerStatus">{t("noSpaces")}</p>}
          {phase === "ready" && spaces.length > 0 && (
            <ul className="uwh-spacePickerList">
              {spaces.map(space => (
                <li key={space.spaceId}>
                  <button
                    type="button"
                    className="uwh-spacePickerItem"
                    disabled={busy}
                    onClick={() => {
                      onCancel();
                      selectSpace(space.dshWorkspaceId);
                    }}
                  >
                    <span className="uwh-spacePickerIcon" aria-hidden="true">◇</span>
                    <span className="uwh-spacePickerName">{space.name}</span>
                    <span className="uwh-spacePickerType">
                      {t(space.type === "personal" ? "personalSpace" : "teamSpace")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
