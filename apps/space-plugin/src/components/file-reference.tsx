import React, { useState } from 'react';
import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { FileText } from 'lucide-react';

/** Own inline control styles, including when used in the Host's main Chat. */
export function WorkspaceReference({
  node,
  interactive,
  openFile,
  sessionId,
}: UserTextNodeProps<'workspace-file'> & {
  openFile(
    node: string,
    resource: string,
    unit: string,
    session: string,
  ): Promise<void>;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const file = node.data;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        maxWidth: '100%',
        verticalAlign: 'middle',
      }}
    >
      <button
        type="button"
        data-workspace-reference={file.nodeId}
        disabled={!interactive || busy}
        aria-label={`Open Workspace file: ${file.label}`}
        title={`Workspace file · ${file.resourceId} · ${file.unitId}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          border: '1px solid currentColor',
          borderRadius: 8,
          padding: '3px 8px',
          font: 'inherit',
          color: 'inherit',
          background: 'transparent',
          cursor: interactive ? 'pointer' : 'default',
          maxWidth: '100%',
        }}
        onClick={() => {
          setBusy(true);
          setError('');
          void openFile(file.nodeId, file.resourceId, file.unitId, sessionId)
            .catch((e: unknown) =>
              setError(
                e instanceof Error
                  ? e.message
                  : 'Unable to open Workspace file.',
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <FileText size={16} strokeWidth={1.6} aria-hidden="true" />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.label}
        </span>
        <small>Workspace</small>
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
