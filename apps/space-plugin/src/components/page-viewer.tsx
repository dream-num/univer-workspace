import React from 'react';
import type { Face } from '../client.js';
import type { State } from '../model.js';
import { Viewer } from '../viewer.js';
import { GapAction, Icon, Menu, button, iconButton } from './primitives.js';
export function PageViewer({ face, v }: { face: Face; v: State }) {
  const file = v.content!;
  return (
    <>
      <header className="sp-page-toolbar">
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
          <button
            role="menuitem"
            className={button + ' tw-w-full'}
            onClick={() => face.pin(file.nodeId)}
          >
            <Icon name="pin" />
            {v.pins.includes(file.nodeId) ? 'Unpin' : 'Pin'}
          </button>
          <GapAction>
            <Icon name="share" />
            Share
          </GapAction>
          <GapAction>Rename</GapAction>
          <GapAction>
            <Icon name="trash" />
            Delete
          </GapAction>
        </Menu>
        <span className="tw-ml-2 tw-text-xs tw-text-muted">View only</span>
        <div className="tw-ml-auto tw-flex tw-items-center tw-gap-1">
          <button
            className={button}
            aria-label="Chat about this document"
            onClick={() => face.chat()}
          >
            <Icon name="chat" size={16} />
            Chat
          </button>
          <button
            disabled
            title="Sharing is not available in Space yet"
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
          <Viewer key={file.nodeId + file.sha256} file={file} />
        </div>
      </div>
    </>
  );
}
