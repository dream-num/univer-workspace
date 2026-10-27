import React, { useEffect, useState, useSyncExternalStore } from 'react';
import type { Face } from '../client.js';
import type { State } from '../model.js';
import { Icon, button } from './primitives.js';

function SignInAction({ face, v }: { face: Face; v: State }) {
  const waiting = ['waiting', 'exchanging'].includes(v.status.oauth?.phase ?? '');
  return <div className="tw-flex tw-flex-col tw-items-start tw-gap-3">
    <button className={button + ' tw-bg-neutral-900 tw-px-5 tw-py-3 tw-text-white'} disabled={v.busy || waiting} onClick={() => face.signIn()}>
      {waiting ? 'Continue in your browser…' : v.status.user ? 'Switch Account' : 'Sign in to Univer'}
    </button>
    {waiting && <button className={button} disabled={v.busy} onClick={() => face.cancelSignIn()}>Cancel sign in</button>}
    {v.status.oauth?.message && <p role="status" className="tw-m-0 tw-text-sm tw-text-muted">{v.status.oauth.message}</p>}
  </div>;
}
export function Welcome({ face, v }: { face: Face; v: State }) {
  return <div className="tw-flex tw-flex-1 tw-items-center tw-justify-center tw-p-8" data-space-welcome>
    <section className="tw-flex tw-max-w-sm tw-flex-col tw-gap-5">
      <Icon name="workspace" size={32} />
      <h1 className="tw-m-0 tw-text-3xl tw-font-semibold">Welcome to Space</h1>
      <p className="tw-m-0 tw-text-sm tw-leading-6 tw-text-muted">Your documents, ideas, and conversations, together.</p>
      <SignInAction face={face} v={v} />
    </section>
  </div>;
}
/** Mounted inside the official settings.section slot; DSH owns dialog chrome. */
export function Settings({ face }: { face: Face }) {
  const v = useSyncExternalStore(face.store.subscribe, face.store.getSnapshot);
  const [endpoint, setEndpoint] = useState(v.status.endpoint || 'https://space.univer.ai');
  useEffect(() => setEndpoint(v.status.endpoint || 'https://space.univer.ai'), [v.status.endpoint]);
  return <div className="sp-shell tw-h-full tw-overflow-y-auto tw-p-6">
    <section className="tw-flex tw-max-w-lg tw-flex-col tw-gap-6" aria-label="Workspace settings">
      <h2 className="tw-m-0 tw-text-xl tw-font-semibold">Workspace</h2>
      <div className="tw-flex tw-flex-col tw-gap-2">
        <h3 className="tw-m-0 tw-text-sm tw-font-semibold">Workspace Account</h3>
        <span data-workspace-status={v.status.state}>{v.status.user?.displayName || v.status.user?.username || 'Not signed in'}</span>
        {v.status.user?.username && <span className="tw-text-sm tw-text-muted">{v.status.user.username}</span>}
      </div>
      <div className="tw-flex tw-flex-col tw-gap-2">
        <h3 className="tw-m-0 tw-text-sm tw-font-semibold">Current Server</h3>
        <span className="tw-text-sm tw-text-muted">{v.status.endpoint || 'https://space.univer.ai'}</span>
      </div>
      <SignInAction face={face} v={v} />
      {v.status.user && <button className={button + ' tw-self-start'} disabled={v.busy} onClick={() => face.disconnect()}>Sign Out</button>}
      <form className="tw-flex tw-flex-col tw-gap-3" onSubmit={event => { event.preventDefault(); face.configure(endpoint); }}>
        <label className="tw-flex tw-flex-col tw-gap-2 tw-text-sm">Custom Workspace URL
          <input aria-label="Custom Workspace URL" className="tw-box-border tw-w-full tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-canvas tw-px-3 tw-py-2 tw-text-sm tw-text-ink" type="url" required value={endpoint} onChange={event => setEndpoint(event.target.value)} disabled={v.busy} />
        </label>
        <button className={button + ' tw-self-start tw-bg-hover'} disabled={v.busy || ['waiting', 'exchanging'].includes(v.status.oauth?.phase ?? '')}>Change Server</button>
      </form>
      {v.error && <p role="alert" className="tw-m-0 tw-text-sm tw-text-red-700">{v.error}</p>}
    </section>
  </div>;
}
