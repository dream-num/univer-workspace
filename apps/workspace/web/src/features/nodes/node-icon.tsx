import {
  BasesMultiIcon,
  BoardsMultiIcon,
  DocsMultiIcon,
  FolderIcon,
  SheetsMultiIcon,
  SlidesMultiIcon,
} from "@univerjs/icons";
import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
} from "lucide-react";
import { cn } from "../../shared/utils/cn";

type UnitType = "sheet" | "doc" | "slide" | "board" | "base";

const unitTypeIcons = {
  doc: DocsMultiIcon,
  sheet: SheetsMultiIcon,
  slide: SlidesMultiIcon,
  board: BoardsMultiIcon,
  base: BasesMultiIcon,
} as const;

/**
 * Univer Resources use the official colored product icons. Blob Resources use
 * MIME-aware neutral file glyphs; organizational Nodes use the group glyph.
 */
export function NodeIcon(props: {
  readonly kind: "resource" | "group";
  readonly resourceKind?: "univer" | "blob" | undefined;
  readonly unitType?: UnitType | null;
  readonly mediaType?: string | null;
  readonly variant?: "menu" | "list";
  readonly className?: string;
}) {
  const sizeClass = props.variant === "list" ? "size-[22px]" : "size-4";

  if (props.kind === "group") {
    return (
      <span
        aria-hidden="true"
        className={cn("inline-flex shrink-0 text-group", props.className)}
      >
        <FolderIcon className={sizeClass} />
      </span>
    );
  }

  const Icon =
    props.resourceKind === "blob"
      ? blobIcon(props.mediaType)
      : props.unitType
        ? unitTypeIcons[props.unitType]
        : null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0",
        Icon ? undefined : "text-resource",
        props.className
      )}
    >
      {Icon ? (
        <Icon className={sizeClass} />
      ) : (
        <File className={sizeClass} strokeWidth={2} />
      )}
    </span>
  );
}

function blobIcon(mediaType: string | null | undefined) {
  if (mediaType?.startsWith("image/")) return FileImage;
  if (mediaType?.startsWith("video/")) return FileVideo;
  if (mediaType?.startsWith("audio/")) return FileAudio;
  if (mediaType?.startsWith("text/") || mediaType === "application/pdf") {
    return FileText;
  }
  if (mediaType === "application/zip") return FileArchive;
  return File;
}
