import { isMarkdownFile } from '@univerjs/univer-workspace-markdown-viewer/content';

/** Product taxonomy shared by every Space surface; wire kinds stay compatible. */
export const contentTypes = [
  {
    kind: 'doc',
    label: 'Docs',
    createLabel: 'Doc',
    runtime: 'editor',
    resource: 'univer',
  },
  {
    kind: 'sheet',
    label: 'Sheets',
    createLabel: 'Sheet',
    runtime: 'editor',
    resource: 'univer',
  },
  {
    kind: 'slide',
    label: 'Slides',
    createLabel: 'Slide',
    runtime: 'editor',
    resource: 'univer',
  },
  {
    kind: 'board',
    label: 'Canvas',
    createLabel: 'Canvas',
    runtime: 'editor',
    resource: 'univer',
  },
  {
    kind: 'base',
    label: 'Relational Table',
    createLabel: 'Relational Table',
    runtime: 'editor',
    resource: 'univer',
  },
  {
    kind: 'site',
    label: 'Pages',
    createLabel: 'Page',
    runtime: 'viewer',
    resource: 'blob',
  },
] as const;
export type ContentKind = (typeof contentTypes)[number]['kind'];
// Read-only Blob previews are not new Unit types or creation entries.
const viewTypes = [...contentTypes, {
  kind: 'markdown', label: 'Markdown', createLabel: 'Markdown', runtime: 'viewer', resource: 'blob',
}] as const;
export type FileKind = (typeof viewTypes)[number]['kind'];
export function blobPreviewKind(filename: string, mediaType: string): 'site' | 'markdown' | null {
  if (filename.toLowerCase().endsWith('.univer.html')) return 'site';
  return isMarkdownFile(filename, mediaType) ? 'markdown' : null;
}
export const createTypes = [
  ...contentTypes,
  { kind: 'folder', label: 'Folder', createLabel: 'Folder', resource: null },
  { kind: 'space', label: 'Space', createLabel: 'Space', resource: null },
] as const;
export const contentType = (kind: string) =>
  viewTypes.find((type) => type.kind === kind);
export const creationName = (kind: string) =>
  createTypes.find((type) => type.kind === kind)?.createLabel ?? kind;
