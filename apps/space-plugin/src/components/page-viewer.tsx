import React, { useState } from 'react';
import type { Face } from '../client.js';
import type { State } from '../model.js';
import { CollaborativeEditor } from '../collaborative-editor.js';
import { Viewer } from '../viewer.js';
import { Icon, Menu, button, iconButton } from './primitives.js';
import { FileActions } from './file-actions.js';
import { contentType } from '../content-types.js';
import { HtmlViewer } from '../html-viewer.js';
export function PageViewer({ face, v }: { face: Face; v: State }) {
  const file = v.content!;
  const [comments, setComments] = useState<{ toggle(): void; visible: boolean } | null>(null);
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
          {(file.type === 'doc' || file.type === 'sheet') && <button className={button} disabled={!comments} aria-label={comments?.visible ? 'Hide comments' : 'Show all comments'} aria-pressed={comments?.visible ?? false} onClick={() => comments?.toggle()}><Icon name="chat" size={16} />Comments</button>}
          <button
            className={button}
            aria-label="Chat about this document"
            onClick={() => face.chat()}
          >
            <Icon name="chat" size={16} />
            Chat
          </button>
          <button
            onClick={() => face.update({ sharing: { kind: 'node', id: file.nodeId, name: file.name } })}
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
      <div
        className={
          'sp-page-body ' +
          (file.type !== 'doc' ? 'sp-sheet-body' : 'sp-doc-body')
        }
      >
        <div className="sp-editor">
          {contentType(file.type)?.runtime === 'editor' ? (
            <CollaborativeEditor
              key={file.nodeId}
              file={file}
              user={v.status.user}
              face={face}
              onCommentsReady={setComments}
            />
          ) : file.type === 'site' ? (
            <HtmlViewer
              key={file.nodeId}
              file={file}
              face={face}
              user={v.status.user}
            />
          ) : (
            <Viewer key={file.nodeId + file.sha256} file={file} />
          )}
        </div>
      </div>
    </>
  );
}
