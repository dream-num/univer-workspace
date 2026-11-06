import React from 'react';
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { WorkspaceReferenceButton } from './file-reference.js';

export function ReturnedFiles({ turn, sessionId, openFile }: Pick<TurnTailOwnerProps, 'turn'> & {
  sessionId: string;
  openFile(node: string, resource: string, unit: string, session: string): Promise<void>;
}) {
  // turnTail is a list slot: its owner is passed directly, without a chain match.
  const files = turn.data.get('spaceReturnedFiles')?.files ?? [];
  if (!files.length) return null;
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
    {files.map(file => <WorkspaceReferenceButton key={`${file.resourceId}/${file.nodeId}`} file={file} interactive sessionId={sessionId} openFile={openFile} />)}
  </div>;
}
