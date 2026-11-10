import React from 'react';
import { MarkdownViewer as WorkspaceMarkdownViewer } from '@univerjs/univer-workspace-markdown-viewer';
import type { OpenFile } from './model.js';

/** A complete, validated Blob read. Preview/Source never materializes a Doc. */
export function MarkdownViewer({ file }: { file: OpenFile }) {
  return <div className="sp-markdown-preview"><WorkspaceMarkdownViewer text={file.markdown ?? ''} locale="en-US" /></div>;
}
