import { isWorkspaceLoginRequired, WorkspaceSignInButton } from "./workspace-login.tsx";
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
import { localizedSpaceName } from "./space-name.ts";

export interface SpaceDirectoryFlowInjected {
  readonly loadSpaces: () => Promise<readonly WorkspaceSpace[]>;
  readonly addSpace: (spaceId: string) => Promise<string>;
  readonly t: (key: UniverLocaleKey) => string;
}

type Phase = "pending" | "ready" | "error" | "login";

/** Product-Space picker replacing DSH's local filesystem directory chooser. */
export function SpaceDirectoryFlow(
  props: DirectoryFlowOwnerProps & SpaceDirectoryFlowInjected,
): ReactElement | null {
  const { open, loadSpaces, onCancel, addSpace, onPicked, t } = props;
  const [adding, setAdding] = useState(false);
  const [addFailed, setAddFailed] = useState(false);
  const busy = props.busy || adding;
  const [phase, setPhase] = useState<Phase>("pending");
  const [attempt, setAttempt] = useState(0);
  const [spaces, setSpaces] = useState<readonly WorkspaceSpace[]>([]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPhase("pending");
    setAddFailed(false);
    void loadSpaces()
      .then((value) => {
        if (!live) return;
        setSpaces(value);
        setPhase("ready");
      })
      .catch((error) => {
        if (live) setPhase(isWorkspaceLoginRequired(error) ? "login" : "error");
      });
    return () => {
      live = false;
    };
  }, [loadSpaces, open, attempt]);

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
          {addFailed && <p className={css.error} role="alert">{t("workspace.spaceAddFailed")}</p>}
          {phase === "pending" && (
            <p className={css.status} role="status">
              {t("workspace.loadingSpaces")}
            </p>
          )}
          {phase === "login" && <div><p>{t("file.authBody")}</p><WorkspaceSignInButton t={t} /></div>}
          {phase === "error" && (
            <p className={css.error} role="alert">
              {t("workspace.spacesLoadFailed")}
              <Button onClick={() => setAttempt(value => value + 1)}>{t("resource.retry")}</Button>
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
                    onClick={async () => {
                      setAdding(true);
                      setAddFailed(false);
                      try {
                        onPicked(await addSpace(space.spaceId));
                      } catch {
                        setAddFailed(true);
                      } finally {
                        setAdding(false);
                      }
                    }}
                  >
                    <span className={css.icon} aria-hidden="true">
                      {space.type === "personal" ? <UserIcon /> : <UsersIcon />}
                    </span>
                    <span className={css.name}>{localizedSpaceName(space, t("workspace.personalSpaceName"))}</span>
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
