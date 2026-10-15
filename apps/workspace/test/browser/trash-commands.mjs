// 仅在可丢弃的本地 Server + Vite 上运行，不连接部署环境。
// WORKSPACE_TEST_ORIGIN=http://127.0.0.1:5173 node --test test/browser/trash-commands.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const origin = process.env.WORKSPACE_TEST_ORIGIN;
assert.ok(origin && new URL(origin).hostname === "127.0.0.1");
const session = `trash-${process.pid}`;
function browser(...args) {
  const result = spawnSync("agent-browser", ["--session", session, "--json", ...args], {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = JSON.parse(result.stdout);
  assert.equal(output.success, true, output.error);
  return output.data;
}
const evaluate = (source) => browser("eval", source).result;

test("回收站命令保持请求、刷新顺序与两种 mode 的确认交互", () => {
  try {
    browser("open", origin);
    browser("wait", "input");
    evaluate(`(async () => {
      window.request = async (path, method = 'GET', body) => {
        const response = await fetch(path, { method, headers: { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (!response.ok) throw new Error(method + ' ' + path + ': ' + response.status);
        return response.status === 204 ? null : response.json();
      };
      await request('/api/auth/password/register', 'POST', { username: 'trash-' + Date.now(),
        password: 'disposable-trash-password', displayName: 'Trash commands' });
      const space = (await request('/api/spaces')).spaces.find(s => s.type === 'personal');
      window.makeBatch = async () => {
        const node = await request('/api/nodes', 'POST', { spaceId: space.id, parentNodeId: null, name: 'Trash fixture' });
        return request('/api/nodes/' + node.id + '/trash', 'POST');
      };
      const entry = await fetch('/src/app/entry.tsx').then(r => r.text());
      const React = (await import(entry.split('"').find(p => p.includes('/react.js?')))).default;
      const ReactDOM = (await import(entry.split('"').find(p => p.includes('/react-dom_client.js?')))).default;
      const source = await fetch('/src/app/providers.tsx').then(r => r.text());
      const { QueryClient, QueryClientProvider } = await import(source.split('"').find(p => p.includes('@tanstack_react-query')));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const c = await import('/src/features/trash/trash.commands.ts');
      function Probe() {
        window.commands = { restore: c.useRestoreTrashBatch(space.id), purge: c.usePurgeTrashBatch(space.id), client, spaceId: space.id };
        return null;
      }
      const host = document.createElement('div'); document.body.append(host);
      const root = ReactDOM.createRoot(host);
      root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)));
      window.renderTrash = async mode => {
        localStorage.setItem('univer-workspace-language', 'en-US');
        localStorage.setItem('univer-workspace-layout-theme', mode);
        const { Providers } = await import('/src/app/providers.tsx');
        const { TrashList } = await import('/src/features/trash/trash-list.tsx');
        root.render(React.createElement(Providers, { key: mode }, React.createElement(QueryClientProvider,
          { client }, React.createElement(TrashList, { spaceId: space.id }))));
      };
    })()`);
    browser("wait", "--fn", "Boolean(window.commands)");
    const initialUrl = browser("get", "url").url;
    evaluate(`(async () => {
      const { restore, purge, client, spaceId } = commands;
      const { api } = await import('/src/shared/api/client.ts');
      const writes = [];
      const recorder = { onRequest: async ({ request }) => {
        if (request.method !== 'GET') writes.push([request.method, new URL(request.url).pathname, await request.clone().text()]);
      }};
      api.use(recorder);
      const batch = await makeBatch();
      const keys = [['trash', spaceId], ['nodes'], ['recent-resources'], ['owned-by-me'], ['shared-with-me'], ['trash', 'other']];
      const prime = () => keys.forEach(key => client.setQueryData(key, null));
      const check = expected => keys.forEach((key, i) => {
        if (client.getQueryState(key).isInvalidated !== expected.includes(i)) throw new Error('失效范围错误: ' + key);
      });
      const invalidate = client.invalidateQueries.bind(client);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      client.invalidateQueries = async options => {
        await invalidate(options);
        if (options.queryKey[0] === 'trash') await gate;
      };
      prime();
      const pending = restore.mutateAsync(batch.id);
      while (!client.getQueryState(keys[0]).isInvalidated) await new Promise(r => setTimeout(r, 10));
      check([0]); release(); await pending; check([0, 1, 2, 3, 4]);
      client.invalidateQueries = invalidate;
      const next = await request('/api/nodes/' + batch.root.id + '/trash', 'POST');
      prime(); await purge.mutateAsync(next.id); check([0]);
      prime();
      let rejected = false;
      try { await restore.mutateAsync(next.id); } catch (error) { rejected = error.name === 'ApiError'; }
      if (!rejected) throw new Error('永久删除后恢复应失败');
      check([]);
      api.eject(recorder);
      const expected = [['POST', '/api/trash-batches/' + batch.id + '/restore', ''],
        ['DELETE', '/api/trash-batches/' + next.id, ''], ['POST', '/api/trash-batches/' + next.id + '/restore', '']];
      if (JSON.stringify(writes) !== JSON.stringify(expected)) throw new Error('请求合同改变');
      if ((await request('/api/spaces/' + spaceId + '/trash')).items.length) throw new Error('回收站未清空');
      client.removeQueries({ queryKey: ['trash', spaceId] });
    })()`);
    for (const mode of ["wiki", "repository"]) {
      evaluate(`(async () => { await makeBatch(); await renderTrash('${mode}'); })()`);
      browser("wait", "button[aria-label='Restore']");
      browser("find", "role", "button", "click", "--name", "Restore", "--exact");
      browser("wait", "--fn", "!document.querySelector('button[aria-label=Restore]')");
      evaluate(
        `(async () => { await makeBatch(); await commands.client.invalidateQueries({ queryKey: ['trash', commands.spaceId] }); })()`,
      );
      browser("wait", "button[aria-label='Remove']");
      browser("find", "role", "button", "click", "--name", "Remove", "--exact");
      browser("find", "role", "button", "click", "--name", "Cancel", "--exact");
      browser("wait", "--fn", "!document.querySelector('[role=alertdialog], [role=dialog], [data-ending-style]')");
      assert.equal(evaluate("document.querySelectorAll('button[aria-label=Remove]').length"), 1);
      browser("find", "role", "button", "click", "--name", "Remove", "--exact");
      browser("wait", "[role=alertdialog]");
      browser("click", "[role=alertdialog] button:last-child");
      browser("wait", "--fn", "!document.querySelector('button[aria-label=Restore]')");
      assert.equal(
        evaluate("(async () => (await request('/api/spaces/' + commands.spaceId + '/trash')).items.length)()"),
        0,
      );
    }
    assert.equal(browser("get", "url").url, initialUrl);
  } finally {
    browser("close");
  }
});
