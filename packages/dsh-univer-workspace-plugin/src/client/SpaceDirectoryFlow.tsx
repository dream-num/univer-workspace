import { useEffect, useState, type ReactElement } from "react";
import {
  Badge,
  Button,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  UserIcon,
  UsersIcon,
} from "@univerjs/univer-workspace-ui";
import type { WorkspaceSpace } from "./workspace-contract.ts";
import type { UniverLocaleKey } from "./locales.ts";
import type { DirectoryFlowOwnerProps } from "./dsh-runtime-types.ts";
import css from "./SpaceDirectoryFlow.module.scss";

export interface SpaceDirectoryFlowInjected {
  readonly loadSpaces: () => Promise<readonly WorkspaceSpace[]>;
  readonly selectSpace: (dshWorkspaceId: string) => void;
  readonly t: (key: UniverLocaleKey) => string;
}

type Phase = "pending" | "ready" | "error";

/** Product-Space picker replacing DSH's local filesystem directory chooser. */
export function SpaceDirectoryFlow(
  props: DirectoryFlowOwnerProps & SpaceDirectoryFlowInjected,
): ReactElement | null {
  const { open, busy, loadSpaces, onCancel, selectSpace, t } = props;
  const [phase, setPhase] = useState<Phase>("pending");
  const [spaces, setSpaces] = useState<readonly WorkspaceSpace[]>([]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPhase("pending");
    void loadSpaces()
      .then((value) => {
        if (!live) return;
        setSpaces(value);
        setPhase("ready");
      })
      .catch(() => {
        if (live) setPhase("error");
      });
    return () => {
      live = false;
    };
  }, [loadSpaces, open]);

  if (!open) return null;
  return (
    <DialogRoot
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel();
      }}
    >
      <DialogContent width="md" closeLabel={t("workspace.cancel")}>
        <DialogHeader>
          <DialogTitle>{t("workspace.chooseSpace")}</DialogTitle>
          <DialogDescription>{t("workspace.chooseSpaceHint")}</DialogDescription>
        </DialogHeader>
        <div className={css.body}>
          {phase === "pending" && (
            <p className={css.status} role="status">
              {t("workspace.loadingSpaces")}
            </p>
          )}
          {phase === "error" && (
            <p className={css.error} role="alert">
              {t("workspace.spacesLoadFailed")}
            </p>
          )}
          {phase === "ready" && spaces.length === 0 && (
            <p className={css.status}>{t("workspace.noSpaces")}</p>
          )}
          {phase === "ready" && spaces.length > 0 && (
            <ul className={css.list}>
              {spaces.map((space) => (
                <li key={space.spaceId}>
                  <Button
                    type="button"
                    className={css.item}
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      onCancel();
                      selectSpace(space.dshWorkspaceId);
                    }}
                  >
                    <span className={css.icon} aria-hidden="true">
                      {space.type === "personal" ? <UserIcon /> : <UsersIcon />}
                    </span>
                    <span className={css.name}>{space.name}</span>
                    <Badge variant="outline">
                      {t(
                        space.type === "personal"
                          ? "workspace.personalSpace"
                          : "workspace.teamSpace",
                      )}
                    </Badge>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {t("workspace.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
