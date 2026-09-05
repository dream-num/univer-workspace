import {
  BasesMultiIcon as UniverBasesMultiIcon,
  BoardsMultiIcon as UniverBoardsMultiIcon,
  DocsMultiIcon as UniverDocsMultiIcon,
  FolderIcon as UniverFolderIcon,
  SheetsMultiIcon as UniverSheetsMultiIcon,
  SlidesMultiIcon as UniverSlidesMultiIcon,
} from "@univerjs/icons";
import {
  ChevronDown as LucideChevronDown,
  ChevronRight as LucideChevronRight,
  Check as LucideCheck,
  Copy as LucideCopy,
  Ellipsis as LucideEllipsis,
  ExternalLink as LucideExternalLink,
  File as LucideFile,
  FileArchive as LucideFileArchive,
  FileAudio as LucideFileAudio,
  FileImage as LucideFileImage,
  FileText as LucideFileText,
  FileVideo as LucideFileVideo,
  Link2 as LucideLink,
  Globe2 as LucideGlobe,
  LockKeyhole as LucideLock,
  ListTree as LucideListTree,
  MessageSquare as LucideMessageSquare,
  Pencil as LucidePencil,
  Plus as LucidePlus,
  RefreshCw as LucideRefresh,
  Send as LucideSend,
  Share2 as LucideShare,
  Trash2 as LucideTrash,
  Upload as LucideUpload,
  UserRound as LucideUser,
  UsersRound as LucideUsers,
  X as LucideClose,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export type WorkspaceIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

// Icon packages follow the host React runtime. This private boundary normalizes
// their React 19 declarations to the React 18-compatible component contract
// shared by both Workspace consumers; the rendered SVG implementation is unchanged.
function icon(component: unknown): WorkspaceIconComponent {
  return component as WorkspaceIconComponent;
}

export const BasesMultiIcon = icon(UniverBasesMultiIcon);
export const BoardsMultiIcon = icon(UniverBoardsMultiIcon);
export const ChevronDownIcon = icon(LucideChevronDown);
export const ChevronRightIcon = icon(LucideChevronRight);
export const CheckIcon = icon(LucideCheck);
export const CloseIcon = icon(LucideClose);
export const CopyIcon = icon(LucideCopy);
export const DocsMultiIcon = icon(UniverDocsMultiIcon);
export const EllipsisIcon = icon(LucideEllipsis);
export const ExternalLinkIcon = icon(LucideExternalLink);
export const FileArchiveIcon = icon(LucideFileArchive);
export const FileAudioIcon = icon(LucideFileAudio);
export const FileIcon = icon(LucideFile);
export const FileImageIcon = icon(LucideFileImage);
export const FileTextIcon = icon(LucideFileText);
export const FileVideoIcon = icon(LucideFileVideo);
export const FolderIcon = icon(UniverFolderIcon);
export const GlobeIcon = icon(LucideGlobe);
export const LinkIcon = icon(LucideLink);
export const LockIcon = icon(LucideLock);
export const ListTreeIcon = icon(LucideListTree);
export const MessageSquareIcon = icon(LucideMessageSquare);
export const PencilIcon = icon(LucidePencil);
export const PlusIcon = icon(LucidePlus);
export const RefreshIcon = icon(LucideRefresh);
export const SendIcon = icon(LucideSend);
export const ShareIcon = icon(LucideShare);
export const SheetsMultiIcon = icon(UniverSheetsMultiIcon);
export const SlidesMultiIcon = icon(UniverSlidesMultiIcon);
export const TrashIcon = icon(LucideTrash);
export const UploadIcon = icon(LucideUpload);
export const UserIcon = icon(LucideUser);
export const UsersIcon = icon(LucideUsers);
