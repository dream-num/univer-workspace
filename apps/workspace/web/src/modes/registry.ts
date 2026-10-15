import type { FolderPageProps } from "./page.types";
import type { SpacePageProps } from "./page.types";
import type { HomePageProps } from "./page.types";
import type { ComponentType } from "react";
import type { WorkspaceShellProps } from "./shell.types";
import type { MessageKey, ModeMessages } from "../shared/i18n";
import { parseUiMode, useUiMode } from "../shared/ui-mode";
import { repositoryMode } from "./repository";
import { wikiMode } from "./wiki";

export interface ModeDefinition {
  readonly pages: {
    readonly folder: ComponentType<FolderPageProps>;
    readonly space: ComponentType<SpacePageProps>;
    readonly home: ComponentType<HomePageProps>;
  };
  readonly Shell: ComponentType<WorkspaceShellProps>;
  readonly label: MessageKey;
  readonly messages: ModeMessages;
}

export const modes = {
  wiki: wikiMode,
  repository: repositoryMode,
} as const satisfies Record<string, ModeDefinition>;

export type WorkspaceMode = keyof typeof modes;
export const MODE_IDS = Object.keys(modes) as readonly WorkspaceMode[];

export function useModeDefinition() {
  const { mode } = useUiMode();
  return modes[parseUiMode(mode, MODE_IDS, "wiki")];
}
