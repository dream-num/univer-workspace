import React, { useState } from 'react';
import type { Face } from '../client.js';
import type { State } from '../model.js';
import { viewerAdapters } from './viewer-adapters.js';
import { Icon, Menu, button, iconButton } from './primitives.js';
import { FileActions } from './file-actions.js';
import { Collaborators } from './collaborators.js';
import type { IMember } from '@univerjs/protocol';
import { AIChanges } from './ai-changes.js';
export function PageViewer({ face, v }: { face: Face; v: State }) {
  return (
    <ResourceViewer
      key={`${v.content!.nodeId}:${v.contentLoadId ?? ''}`}
      face={face}
      v={v}
    />
  );
}

/** Toolbar callbacks and collaborators belong to this exact resource mount. */
function ResourceViewer({ face, v }: { face: Face; v: State }) {
  const file = v.content!;
  const adapter = viewerAdapters[file.type];
  const Editor = adapter.Editor;
  const [members, setMembers] = useState<readonly IMember[]>([]);
  const [comments, setComments] = useState<{
    toggle(): void;
    visible: boolean;
  } | null>(null);
  return (
    <>
      <header className="sp-page-toolbar" data-window-drag>
        <Menu
          label="File menu"
          align="left"
          trigger={
            <>
              <Icon name={file.type} size={16} />
              <span className="tw-max-w-64 tw-truncate">{file.name}</span>
              <Icon name="down" size={12} />
            </>
          }
        >
          <button
            role="menuitem"
            className={button + ' tw-w-full'}
            onClick={() => face.close()}
          >
            <Icon name="all" />
            Show files
          </button>
          {file.node && (
            <FileActions face={face} v={v} node={file.node} open={false} />
          )}
        </Menu>
        <div className="tw-ml-auto tw-flex tw-items-center tw-gap-1">
          <Collaborators members={members} currentUserId={v.status.user?.id} />
          {adapter.comments && (
            <button
              className={button}
              disabled={!comments}
              aria-label={
                comments?.visible ? 'Hide comments' : 'Show all comments'
              }
              aria-pressed={comments?.visible ?? false}
              onClick={() => comments?.toggle()}
            >
              <Icon name="chat" size={16} />
              Comments
            </button>
          )}
          <button
            className={button}
            aria-label="Chat about this document"
            onClick={() => face.chat()}
          >
            <Icon name="chat" size={16} />
            Chat
          </button>
          <button
            onClick={() =>
              face.update({
                sharing: { kind: 'node', id: file.nodeId, name: file.name },
              })
            }
            className={button}
          >
            <Icon name="share" size={16} />
            Share
          </button>
          <button
            className={iconButton + ' tw-rounded-full'}
            aria-label="Close viewer"
            onClick={() => face.close()}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </header>
      {adapter.review && (
        <AIChanges
          key={file.nodeId + v.sessionId}
          face={face}
          file={file}
          sessionId={v.sessionId}
        />
      )}
      <div
        className={'sp-page-body ' + adapter.body}
        data-viewer-kind={file.type}
      >
        <div className="sp-editor">
          <Editor
            file={file}
            user={v.status.user}
            face={face}
            onCommentsReady={setComments}
            onCollaborators={setMembers}
          />
        </div>
      </div>
    </>
  );
}
