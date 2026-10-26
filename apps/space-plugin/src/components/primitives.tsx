import React, { useEffect, useRef } from 'react';
import { createTypes, creationName } from '../content-types.js';
import {
  LayoutGrid,
  FileText,
  Table2,
  Folder,
  Search,
  X,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  PanelLeft,
  Sparkles,
  Settings2,
  Image,
  Globe,
  Trash2,
  Pin,
  Ellipsis,
  Clock3,
  List,
  SlidersHorizontal,
  Grip,
  Minus,
  Maximize2,
  MessageCircle,
  History,
  Presentation,
  Share2,
  Check,
  Copy,
  File,
  PanelsTopLeft,
  Database,
  SquareMousePointer,
  type LucideIcon,
} from 'lucide-react';
const icons: Record<string, LucideIcon> = {
  all: LayoutGrid,
  workspace: PanelsTopLeft,
  base: Database,
  board: SquareMousePointer,
  doc: FileText,
  sheet: Table2,
  folder: Folder,
  search: Search,
  close: X,
  arrow: ArrowLeft,
  chevron: ChevronRight,
  down: ChevronDown,
  plus: Plus,
  panel: PanelLeft,
  spark: Sparkles,
  settings: Settings2,
  image: Image,
  site: Globe,
  trash: Trash2,
  pin: Pin,
  more: Ellipsis,
  clock: Clock3,
  list: List,
  grid: LayoutGrid,
  filter: SlidersHorizontal,
  grip: Grip,
  minimize: Minus,
  expand: Maximize2,
  chat: MessageCircle,
  history: History,
  slide: Presentation,
  share: Share2,
  check: Check,
  copy: Copy,
  file: File,
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Glyph = icons[name] ?? File;
  return <Glyph size={size} strokeWidth={1.6} aria-hidden="true" />;
}
export const button =
  'sp-control hover:tw-bg-hover focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-blue-500 disabled:tw-opacity-40 disabled:tw-cursor-default';
export const iconButton =
  button + ' tw-h-9 tw-w-9 tw-justify-center tw-p-0 tw-shrink-0';
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-p-10 tw-text-center">
      <Icon name="folder" size={28} />
      <h2 className="tw-m-0 tw-text-sm tw-font-medium">{title}</h2>
      <div className="tw-text-[13px] tw-leading-6 tw-text-muted">
        {children}
      </div>
    </div>
  );
}
/** Menus share dismissal and keyboard rules; only this plugin's own controls are touched. */
export function Menu({
  label,
  children,
  trigger,
  align = 'right',
}: {
  label: string;
  children: React.ReactNode;
  trigger: React.ReactNode;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node))
        ref.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details
      ref={ref}
      className="sp-menu"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          ref.current?.removeAttribute('open');
          ref.current?.querySelector('summary')?.focus();
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (ref.current) ref.current.open = true;
          const items = Array.from(
            ref.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menu"] button:not(:disabled)',
            ) ?? [],
          );
          const n = items.indexOf(document.activeElement as HTMLButtonElement);
          items[
            (n + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          ]?.focus();
        }
      }}
    >
      <summary aria-label={label} className={button}>
        {trigger}
      </summary>
      <div
        role="menu"
        aria-label={label}
        className={'sp-menu-body sp-menu-' + align}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button:not(:disabled)'))
            ref.current?.removeAttribute('open');
        }}
      >
        {children}
      </div>
    </details>
  );
}
export function GapAction({ children }: { children: React.ReactNode }) {
  return (
    <button
      role="menuitem"
      disabled
      className={button + ' tw-w-full tw-justify-start'}
      title="This action is not available in Space yet"
    >
      {children}
    </button>
  );
}
/** Complete contract menu. Permission limits affect availability, never membership. */
export function CreateMenu({
  face,
  v,
  sidebar = false,
}: {
  face: import('../client.js').Face;
  v: import('../model.js').State;
  sidebar?: boolean;
}) {
  const [draft, setDraft] = React.useState<{
    kind: string;
    space: string;
    parent: string;
    key: string;
  } | null>(null);
  const [name, setName] = React.useState('');
  const inDirectory = v.location === 'folder' || v.location === 'space';
  const destination = inDirectory
    ? v.spaces.find((s) => s.id === v.space)
    : v.spaces.find((s) => s.type === 'personal');
  const allowed =
    inDirectory && v.parent
      ? v.page?.parentNode?.capabilities?.createChildren === true
      : destination?.capabilities?.createAtRoot === true;
  if (v.status.state !== 'connected') return null;
  return (
    <>
      <Menu
        label={inDirectory ? 'New' : 'Create'}
        align={sidebar ? 'left' : 'right'}
        trigger={
          <>
            {sidebar && <Icon name="plus" size={18} />}
            <span>{inDirectory ? 'New' : 'Create'}</span>
            <Icon name="down" size={12} />
          </>
        }
      >
        {createTypes.map(({ kind, createLabel: label }) => (
          <button
            key={kind}
            role="menuitem"
            className={button + ' tw-w-full'}
            disabled={v.busy || (kind !== 'space' && !allowed)}
            title={
              kind !== 'space' && !allowed
                ? 'You do not have permission to create here'
                : undefined
            }
            onClick={() => {
              setName('');
              setDraft({
                kind,
                space: destination?.id ?? '',
                parent: inDirectory ? v.parent : '',
                key: crypto.randomUUID(),
              });
            }}
          >
            <Icon name={kind === 'space' ? 'all' : kind} />
            {label}
          </button>
        ))}
      </Menu>
      {draft && (
        <div className="sp-create-backdrop">
          <form
            role="dialog"
            aria-modal="true"
            aria-label={`Create ${draft.kind}`}
            className="sp-create-dialog"
            onSubmit={async (e) => {
              e.preventDefault();
              await face.create({ ...draft, name });
              if (!face.store.getSnapshot().error) setDraft(null);
            }}
          >
            <h2>Create {creationName(draft.kind)}</h2>
            {draft.kind !== 'space' && (
              <p>
                In {draft.parent ? v.page?.parentNode?.name : destination?.name}
              </p>
            )}
            <label>
              Name
              <input
                autoFocus
                required
                maxLength={draft.kind === 'space' ? 100 : 255}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDraft({ ...draft, key: crypto.randomUUID() });
                }}
              />
            </label>
            {v.error && <p role="alert">{v.error}</p>}
            <div className="tw-flex tw-justify-end tw-gap-2">
              <button
                type="button"
                className={button}
                disabled={v.busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button className={button} disabled={v.busy || !name.trim()}>
                {v.busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
