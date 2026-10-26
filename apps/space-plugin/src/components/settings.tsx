import React, { useEffect, useRef, useState } from 'react';
import type { Face } from '../client.js';
import type { State } from '../model.js';
import { Icon, button, iconButton } from './primitives.js';
export function Settings({ face, v }: { face: Face; v: State }) {
  const [endpoint, setEndpoint] = useState(v.status.endpoint),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const modal = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') face.update({ settings: false });
    };
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('keydown', close);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(
            '[data-space-sidebar] button[aria-label="Space settings"]',
          )
          ?.focus(),
      );
    };
  }, []);
  const input =
    'tw-box-border tw-w-full tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-canvas tw-px-3 tw-py-2 tw-text-sm tw-text-ink';
  const states: Record<string, string> = {
    unconfigured: '未连接',
    connected: '已连接',
    unauthenticated: '请登录 Workspace',
    'network-error': '连接暂不可用',
  };
  return (
    <div
      className="tw-absolute tw-inset-0 tw-z-50 tw-flex tw-items-center tw-justify-center tw-bg-black/20 tw-p-6"
      onClick={() => face.update({ settings: false })}
    >
      <section
        ref={modal}
        role="dialog"
        aria-modal="true"
        aria-label="Space settings"
        className="tw-box-border tw-flex tw-max-h-full tw-w-[440px] tw-flex-col tw-gap-5 tw-overflow-y-auto tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-canvas tw-p-6 tw-shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            const controls = Array.from(
                modal.current?.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),input:not(:disabled),a[href]',
                ) ?? [],
              ),
              first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="tw-flex tw-items-center tw-justify-between">
          <h1 className="tw-m-0 tw-text-lg tw-font-semibold">Space settings</h1>
          <button
            autoFocus
            className={iconButton}
            aria-label="关闭设置"
            onClick={() => face.update({ settings: false })}
          >
            <Icon name="close" />
          </button>
        </header>
        <p className="tw-m-0 tw-text-xs tw-leading-5 tw-text-muted">
          这里管理 Workspace 账户；不会退出或切换你的 DSH 聊天会话。
        </p>
        <form
          className="tw-flex tw-flex-col tw-gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!v.busy) face.configure(endpoint);
          }}
        >
          <label className="tw-flex tw-flex-col tw-gap-2 tw-text-xs">
            Workspace 服务地址
            <input
              aria-label="Workspace Endpoint"
              className={input}
              required
              type="url"
              disabled={v.busy}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </label>
          <button
            className={button + ' tw-self-start tw-bg-hover'}
            disabled={v.busy}
          >
            {v.status.endpoint ? '重新连接' : '连接服务'}
          </button>
        </form>
        <div
          role="status"
          data-workspace-status={v.status.state}
          className="tw-text-xs tw-text-muted"
        >
          {states[v.status.state] ?? '正在连接'}
          {v.status.user &&
            ` · ${v.status.user.displayName ?? v.status.user.username}`}
        </div>
        {v.status.endpoint && v.status.state !== 'connected' && (
          <form
            className="tw-flex tw-flex-col tw-gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!v.busy) {
                face.login(username, password);
                setPassword('');
              }
            }}
          >
            <label className="tw-flex tw-flex-col tw-gap-2 tw-text-xs">
              用户名
              <input
                className={input}
                required
                autoComplete="username"
                disabled={v.busy}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-2 tw-text-xs">
              密码
              <input
                className={input}
                required
                autoComplete="current-password"
                type="password"
                disabled={v.busy}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button
              disabled={v.busy}
              className={
                button + ' tw-self-start tw-bg-neutral-800 tw-text-white'
              }
            >
              登录 Workspace
            </button>
          </form>
        )}
        {v.error && (
          <p role="alert" className="tw-m-0 tw-text-xs tw-text-red-700">
            {v.error}
          </p>
        )}
        {v.status.endpoint && (
          <button
            className={button + ' tw-self-start'}
            disabled={v.busy}
            onClick={() => face.disconnect()}
          >
            断开 Workspace
          </button>
        )}
      </section>
    </div>
  );
}
