/**
 * Shared Unit type/change icon maps for the middle Worktree review surface.
 * @module dsh-univer-workspace-plugin/client/components/worktree-review/unit-markers
 */

import type { ReactElement } from "react";
import {
  BasesMultiIcon,
  BoardsMultiIcon,
  DocsMultiIcon,
  FileIcon,
  PencilIcon,
  PlusIcon,
  SheetsMultiIcon,
  SlidesMultiIcon,
  TrashIcon,
  type WorkspaceIconComponent,
} from "@univerjs/univer-workspace-ui";

const UNIT_TYPE_ICONS: Readonly<Record<string, WorkspaceIconComponent>> = {
  sheet: SheetsMultiIcon,
  doc: DocsMultiIcon,
  slide: SlidesMultiIcon,
  board: BoardsMultiIcon,
  base: BasesMultiIcon,
};

export function UnitTypeIcon(props: {
  readonly type: string;
  readonly className?: string | undefined;
}): ReactElement {
  const Icon = UNIT_TYPE_ICONS[props.type] ?? FileIcon;
  return <Icon className={props.className} aria-hidden="true" />;
}

const UNIT_CHANGE_ICONS: Readonly<Record<string, WorkspaceIconComponent>> = {
  modified: PencilIcon,
  added: PlusIcon,
  deleted: TrashIcon,
};

export function UnitChangeIcon(props: {
  readonly kind: string;
  readonly className?: string | undefined;
}): ReactElement | null {
  const Icon = UNIT_CHANGE_ICONS[props.kind];
  return Icon === undefined ? null : <Icon className={props.className} aria-hidden="true" />;
}
