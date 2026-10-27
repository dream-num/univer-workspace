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
export const createTypes = [
  ...contentTypes,
  { kind: 'folder', label: 'Folder', createLabel: 'Folder', resource: null },
  { kind: 'space', label: 'Space', createLabel: 'Space', resource: null },
] as const;
export const contentType = (kind: string) =>
  contentTypes.find((type) => type.kind === kind);
export const creationName = (kind: string) =>
  createTypes.find((type) => type.kind === kind)?.createLabel ?? kind;
