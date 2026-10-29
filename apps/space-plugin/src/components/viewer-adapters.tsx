import React from 'react';
import { CollaborativeEditor } from '../collaborative-editor.js';
import { HtmlViewer } from '../html-viewer.js';
import type { OpenFile } from '../model.js';

type Adapter = {
  comments: boolean;
  review: boolean;
  body: string;
  Editor: React.ComponentType<React.ComponentProps<typeof CollaborativeEditor>>;
};
const collaborative = {
  comments: false,
  review: false,
  body: 'sp-sheet-body',
  Editor: CollaborativeEditor,
};
/** All five Univer formats retain the formal collaborative runtime. Pages use
 * the shared HTML Viewer and its prepare-to-leave/resume protocol. */
export const viewerAdapters: Record<OpenFile['type'], Adapter> = {
  doc: { ...collaborative, comments: true, review: true, body: 'sp-doc-body' },
  sheet: { ...collaborative, comments: true, review: true },
  slide: collaborative,
  board: collaborative,
  base: collaborative,
  site: {
    comments: false,
    review: false,
    body: 'sp-sheet-body',
    Editor: HtmlViewer,
  },
};
