import React from 'react';
import { WorkspaceReferenceButton } from './file-reference.js';

type Reference = { label: string; nodeId: string; resourceId: string; unitId: string };
export function ReturnedFiles({ matched, sessionId, openFile }: {
  matched: { files: readonly Reference[] };
  sessionId: string;
  openFile(node: string, resource: string, unit: string, session: string): Promise<void>;
}) {
  if (!matched.files.length) return null;
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
    {matched.files.map(file => <WorkspaceReferenceButton key={`${file.resourceId}/${file.nodeId}`} file={file} interactive sessionId={sessionId} openFile={openFile} />)}
  </div>;
}
