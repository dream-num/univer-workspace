import {
  BasesMultiIcon,
  BoardsMultiIcon,
  DocsMultiIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FileVideoIcon,
  FolderIcon,
  SheetsMultiIcon,
  SlidesMultiIcon,
  type WorkspaceIconComponent,
} from "@univerjs/univer-workspace-ui";
import type { WorkspaceFileResource, WorkspaceUnitType } from "./types.js";
import css from "./NodeIcon.module.scss";

const unitIcons: Record<WorkspaceUnitType, WorkspaceIconComponent> = {
  doc: DocsMultiIcon,
  sheet: SheetsMultiIcon,
  slide: SlidesMultiIcon,
  board: BoardsMultiIcon,
  base: BasesMultiIcon,
};

export function NodeIcon(props: {
  readonly resource: WorkspaceFileResource | null;
  readonly variant?: "menu" | "list";
}) {
  const sizeClass = props.variant === "list" ? css.list : css.menu;
  if (props.resource === null) {
    return (
      <span className={`${css.icon} ${css.folder}`} aria-hidden="true">
        <FolderIcon className={sizeClass} />
      </span>
    );
  }
  const Icon =
    props.resource.kind === "blob"
      ? blobIcon(props.resource.mediaType)
      : props.resource.unitType
        ? unitIcons[props.resource.unitType]
        : FileIcon;
  return (
    <span className={css.icon} aria-hidden="true">
      <Icon className={sizeClass} />
    </span>
  );
}

function blobIcon(mediaType: string | undefined): WorkspaceIconComponent {
  if (mediaType?.startsWith("image/")) return FileImageIcon;
  if (mediaType?.startsWith("video/")) return FileVideoIcon;
  if (mediaType?.startsWith("audio/")) return FileAudioIcon;
  if (mediaType?.startsWith("text/") || mediaType === "application/pdf") return FileTextIcon;
  if (mediaType === "application/zip") return FileArchiveIcon;
  return FileIcon;
}
