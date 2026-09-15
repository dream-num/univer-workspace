import {
  BasesMultiIcon,
  BoardsMultiIcon,
  DocsMultiIcon,
  FolderIcon,
  SheetsMultiIcon,
  SlidesMultiIcon,
} from "@univerjs/icons";
import { File } from "lucide-react";
import { getWorkspaceBlobIcon } from "@univerjs/univer-workspace-file-browser";
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
 * a dedicated HTML view icon or MIME-aware file glyphs; groups use the folder glyph.
 */
export function NodeIcon(props: {
  readonly kind: "resource" | "group";
  readonly resourceKind?: "univer" | "blob" | undefined;
  readonly unitType?: UnitType | null;
  readonly mediaType?: string | null;
  readonly name?: string;
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
      ? getWorkspaceBlobIcon(props.mediaType, props.name)
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
