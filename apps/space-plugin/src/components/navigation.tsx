import React, { useSyncExternalStore } from 'react';
import type { Face } from '../client.js';
import { contentKinds, nodeKind, type State } from '../model.js';
import { CreateMenu, Icon, button, iconButton } from './primitives.js';

/** Only the public sidebar.workspaces region changes; DSH owns its column and controls. */
export function HostNavigation(
  props: Face & { wide: boolean; expandSidebar(): void },
) {
  const v = useSyncExternalStore(
    props.store.subscribe,
    props.store.getSnapshot,
  );
  return (
    <div
      className="sp-shell sp-host-navigation"
      data-space-sidebar
      data-wide={props.wide}
    >
      <Navigation
        face={props}
        v={v}
        wide={props.wide}
        expand={props.expandSidebar}
      />
    </div>
  );
}
export function Navigation({
  face,
  v,
  wide,
  expand,
}: {
  face: Face;
  v: State;
  wide: boolean;
  expand(): void;
}) {
  const row = button + ' sp-nav-row';
  if (!wide)
    return (
      <nav className="sp-navigation-rail" aria-label="Space navigation">
        <button
          className={iconButton}
          aria-label="Expand Space navigation"
          title="Space navigation"
          onClick={expand}
        >
          <Icon name="workspace" />
        </button>
        {contentKinds.map(([filter, label]) => (
          <button
            key={filter}
            className={iconButton}
            aria-label={label}
            title={label}
            onClick={() => {
              face.home();
              face.update({ filter });
            }}
          >
            <Icon name={filter} />
          </button>
        ))}
        <button
          className={iconButton}
          aria-label="Back to Chat"
          title="Back to Chat"
          onClick={face.back}
        >
          <Icon name="arrow" />
        </button>
        <button
          className={iconButton}
          aria-label="Workspace settings"
          title="Workspace settings"
          onClick={() => face.update({ settings: true })}
        >
          <Icon name="settings" />
        </button>
      </nav>
    );
  return (
    <nav key="wide" aria-label="Space navigation" className="sp-navigation">
      <div className="sp-nav-heading">
        <strong>Space</strong>
        <button
          className={iconButton}
          aria-label="Search Space content"
          onClick={() => {
            face.home();
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLInputElement>('.sp-browser .sp-search input')
                ?.focus(),
            );
          }}
        >
          <Icon name="search" />
        </button>
      </div>
      <div className="sp-nav-create">
        <CreateMenu />
      </div>
      <div className="sp-nav-scroll">
        {([['all', 'All'], ...contentKinds] as const).map(([filter, label]) => (
          <button
            key={filter}
            className={
              row +
              (v.location === 'home' && v.filter === filter && !v.content
                ? ' sp-selected'
                : '')
            }
            onClick={() => {
              face.home();
              face.update({ filter });
            }}
          >
            <Icon name={filter} />
            {label}
          </button>
        ))}
        {v.pins.length > 0 && (
          <>
            <div className="sp-nav-section">Pinned</div>
            {v.pins
              .map((id) => v.all.find((node) => node.id === id))
              .filter(Boolean)
              .map((node) => (
                <button
                  key={node!.id}
                  className={row}
                  onClick={() =>
                    node!.resource
                      ? face.open(node!.id)
                      : face.directory(node!.spaceId ?? v.space, node!.id)
                  }
                >
                  <Icon name={nodeKind(node!)} />
                  <span className="tw-truncate">{node!.name}</span>
                </button>
              ))}
          </>
        )}
        <button
          className={row + ' sp-nav-section sp-section-button'}
          onClick={() => face.home('recent')}
        >
          Recents <Icon name="down" size={12} />
        </button>
        {v.recent.slice(0, 7).map((item) => (
          <button
            key={item.node.id}
            title={item.node.name}
            className={
              row + (v.content?.nodeId === item.node.id ? ' sp-selected' : '')
            }
            onClick={() => face.open(item.node.id)}
          >
            <Icon name={nodeKind({ ...item.node, resource: item.resource })} />
            <span className="tw-truncate">{item.node.name}</span>
          </button>
        ))}
        <div className="sp-nav-section">Spaces</div>
        {v.spaces.map((space) => (
          <button
            key={space.id}
            className={
              row +
              (v.space === space.id && v.location === 'space' && !v.content
                ? ' sp-selected'
                : '')
            }
            onClick={() => face.directory(space.id)}
          >
            <Icon name="all" />
            <span className="tw-truncate">{space.name}</span>
          </button>
        ))}
      </div>
      <button className={row} onClick={face.back}>
        <Icon name="arrow" />
        Back to Chat
      </button>
      <button
        className={row + ' tw-text-muted'}
        aria-label="Workspace settings"
        onClick={() => face.update({ settings: true })}
      >
        <Icon name="settings" />
        <span className="tw-truncate">
          {v.status.user?.displayName ??
            v.status.user?.username ??
            'Connect Workspace'}
        </span>
      </button>
    </nav>
  );
}
