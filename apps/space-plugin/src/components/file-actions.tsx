import React, { useEffect, useRef, useState } from 'react';
import type { Face } from '../client.js';
import type { Node, Page, State } from '../model.js';
import { GapAction, Icon, button } from './primitives.js';

/** Shared by row More, context menu and the open file's identity menu. */
export function FileActions({
  face,
  v,
  node,
  open = true,
}: {
  face: Face;
  v: State;
  node: Node;
  open?: boolean;
}) {
  return (
    <>
      {open && (
        <button
          role="menuitem"
          className={button + ' tw-w-full'}
          onClick={() =>
            node.resource
              ? face.open(node.id)
              : face.directory(node.spaceId ?? v.space, node.id)
          }
        >
          Open
        </button>
      )}
      <button
        role="menuitem"
        className={button + ' tw-w-full'}
        onClick={() => face.pin(node.id)}
      >
        <Icon name="pin" />
        {v.pins.includes(node.id) ? 'Unpin' : 'Pin'}
      </button>
      <GapAction>
        <Icon name="share" />
        Share
      </GapAction>
      {(
        [
          ['rename', 'Rename', 'rename'],
          ['move', 'Move to folder', 'move'],
          ['delete', 'Delete', 'trash'],
        ] as const
      ).map(([kind, label, capability]) => (
        <button
          key={kind}
          role="menuitem"
          className={button + ' tw-w-full'}
          disabled={v.busy || node.capabilities?.[capability] !== true}
          title={
            node.capabilities?.[capability] !== true
              ? 'You do not have permission for this action'
              : undefined
          }
          onClick={() =>
            face.update({ action: { kind, node }, error: '', notice: '' })
          }
        >
          {kind === 'delete' && <Icon name="trash" />}
          {label}
        </button>
      ))}
    </>
  );
}

export function FileActionDialog({ face, v }: { face: Face; v: State }) {
  const action = v.action!;
  const [name, setName] = useState(
    action.node?.name ?? action.space?.name ?? '',
  );
  const [destination, setDestination] = useState<Page | null>(null);
  const [parent, setParent] = useState('');
  const [loading, setLoading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const sequence = useRef(0);
  const space = action.node?.spaceId ?? v.space;
  const browse = async (next: string) => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const page = await face.readDirectory(space, next);
      if (request !== sequence.current) return;
      setDestination(page);
      setParent(next);
    } catch (error) {
      if (request === sequence.current)
        face.update({
          error:
            error instanceof Error ? error.message : 'Cannot open this folder.',
        });
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    dialog.current?.showModal();
    if (action.kind === 'move') void browse('');
    return () => {
      sequence.current++;
    };
  }, []);
  const label =
    action.kind === 'delete'
      ? 'Delete'
      : action.kind === 'move'
        ? 'Move to folder'
        : 'Rename';
  const permittedDestination =
    destination &&
    (parent
      ? destination.parentNode?.capabilities?.createChildren
      : v.spaces.find((s) => s.id === space)?.capabilities?.createAtRoot);
  return (
    <dialog
      ref={dialog}
      className="sp-create-dialog sp-action-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        if (!v.busy) face.update({ action: null });
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          await face.mutate({
            action: action.kind,
            id: action.node?.id ?? action.space!.id,
            name,
            parent,
          });
        }}
      >
        <h2>{label}</h2>
        {action.kind === 'delete' ? (
          <p>
            Move “{name}”{action.node?.resource ? '' : ' and its contents'} to
            Trash? You can restore it later.
          </p>
        ) : action.kind === 'move' ? (
          <>
            <p>Move “{action.node?.name}”</p>
            <nav aria-label="Move destination" className="sp-move-path">
              <button
                type="button"
                className={button}
                onClick={() => browse('')}
              >
                {v.spaces.find((s) => s.id === space)?.name ?? 'Space'}
              </button>
              {destination?.breadcrumbs?.map((crumb) => (
                <button
                  type="button"
                  key={crumb.id}
                  className={button}
                  onClick={() => browse(crumb.id)}
                >
                  <Icon name="chevron" size={12} />
                  {crumb.name}
                </button>
              ))}
            </nav>
            <div className="sp-move-folders" aria-busy={loading}>
              {loading ? (
                <p role="status">Loading folders…</p>
              ) : (
                destination?.nodes
                  .filter(
                    (node) => !node.resource && node.id !== action.node?.id,
                  )
                  .map((node) => (
                    <button
                      type="button"
                      className={button + ' tw-w-full'}
                      key={node.id}
                      onClick={() => browse(node.id)}
                    >
                      <Icon name="folder" />
                      {node.name}
                      <Icon name="chevron" />
                    </button>
                  ))
              )}
              {!loading &&
                !destination?.nodes.some(
                  (node) => !node.resource && node.id !== action.node?.id,
                ) && <p>No folders here</p>}
              {destination?.nextCursor && (
                <button
                  type="button"
                  className={button}
                  onClick={async () => {
                    const page = await face.readDirectory(
                      space,
                      parent,
                      destination.nextCursor!,
                    );
                    setDestination({
                      ...page,
                      nodes: [...destination.nodes, ...page.nodes],
                    });
                  }}
                >
                  Load more folders
                </button>
              )}
            </div>
            {destination && !permittedDestination && (
              <p>You do not have permission to move items here.</p>
            )}
          </>
        ) : (
          <label>
            Name
            <input
              autoFocus
              required
              maxLength={action.kind === 'rename-space' ? 100 : 255}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {v.error && <p role="alert">{v.error}</p>}
        <div className="tw-mt-4 tw-flex tw-justify-end tw-gap-2">
          <button
            type="button"
            className={button}
            disabled={v.busy}
            onClick={() => face.update({ action: null })}
          >
            Cancel
          </button>
          <button
            className={button}
            disabled={
              v.busy ||
              loading ||
              (action.kind === 'move' ? !permittedDestination : !name.trim())
            }
          >
            {v.busy
              ? 'Working…'
              : action.kind === 'move'
                ? 'Move here'
                : action.kind === 'delete'
                  ? 'Move to Trash'
                  : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function TrashBrowser({ face, v }: { face: Face; v: State }) {
  return (
    <section className="sp-library sp-trash">
      <header className="sp-library-heading">
        <h1>Trash</h1>
        <button
          className={button}
          disabled={v.busy}
          onClick={() => face.showTrash()}
        >
          Refresh
        </button>
      </header>
      {!v.trash.length && <p>Trash is empty</p>}
      {v.trash.map((batch) => (
        <div key={batch.id} className="sp-trash-row">
          <div>
            <strong>{batch.root.name}</strong>
            <p>
              {v.spaces.find((s) => s.id === batch.spaceId)?.name} /{' '}
              {batch.originalLocation.breadcrumbs
                .map((crumb) => crumb.name)
                .join(' / ')}
            </p>
            {batch.restoreBlockedBy && <p>Restore the parent folder first.</p>}
          </div>
          <button
            className={button}
            disabled={v.busy || !batch.capabilities.restore}
            onClick={() => face.mutate({ action: 'restore', id: batch.id })}
          >
            Restore
          </button>
        </div>
      ))}
    </section>
  );
}
