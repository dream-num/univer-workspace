// 仅在可丢弃的本地 Server + Vite 上运行，不连接部署环境。
// WORKSPACE_TEST_ORIGIN=http://127.0.0.1:5173 node --test test/browser/permissions-commands.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const origin = process.env.WORKSPACE_TEST_ORIGIN;
assert.ok(origin && new URL(origin).hostname === "127.0.0.1");
const session = `permissions-${process.pid}`;
function browser(...args) {
  const result = spawnSync("agent-browser", ["--session", session, "--json", ...args], {
    encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  const output = JSON.parse(result.stdout);
  assert.equal(output.success, true, output.error);
  return output.data;
}
const evaluate = (source) => browser("eval", source).result;

test("权限命令保持请求合同、定向失效，并传播服务端拒绝", () => {
  try {
    browser("open", origin);
    browser("wait", "input");
    evaluate(`(async () => {
      window.permissionRequest = async (path, method = 'GET', body) => {
        const response = await fetch(path, {
          method, headers: { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) throw new Error(method + ' ' + path + ': ' + response.status);
        return response.status === 204 ? null : response.json();
      };
      const password = 'disposable-permissions-password';
      const suffix = Date.now();
      const guest = { username: 'permission-guest-' + suffix, password, displayName: 'Permission Guest' };
      const guestSession = await permissionRequest('/api/auth/password/register', 'POST', guest);
      const owner = { username: 'permission-owner-' + suffix, password, displayName: 'Permission Owner' };
      await permissionRequest('/api/auth/password/register', 'POST', owner);
      const space = await permissionRequest('/api/team-spaces', 'POST', { name: 'Permission commands', publicRead: false });
      const personal = (await permissionRequest('/api/spaces')).spaces.find(s => s.type === 'personal');
      const node = await permissionRequest('/api/nodes', 'POST', { spaceId: personal.id, parentNodeId: null, name: 'Shared folder' });
      window.permissionFixture = { owner, guest, userId: guestSession.user.id, spaceId: space.id, nodeId: node.id };

      const entry = await fetch('/src/app/entry.tsx').then(r => r.text());
      const React = (await import(entry.split('"').find(p => p.includes('/react.js?')))).default;
      const ReactDOM = (await import(entry.split('"').find(p => p.includes('/react-dom_client.js?')))).default;
      const source = await fetch('/src/app/providers.tsx').then(r => r.text());
      const { QueryClient, QueryClientProvider } = await import(source.split('"').find(p => p.includes('@tanstack_react-query')));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const c = await import('/src/features/permissions/permissions.commands.ts');
      function Probe() {
        window.permissionCommands = {
          grant: c.useSetNodeGrant(), removeGrant: c.useRemoveNodeGrant(),
          link: c.useSetLinkSharing(), member: c.useSetMemberRole(), removeMember: c.useRemoveMember(), client,
        };
        return null;
      }
      const host = document.createElement('div'); document.body.append(host);
      window.permissionRoot = ReactDOM.createRoot(host);
      permissionRoot.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)));
      window.renderPermissionView = async (kind, mode) => {
        localStorage.setItem('univer-workspace-language', 'en-US');
        localStorage.setItem('univer-workspace-layout-theme', mode);
        const { Providers } = await import('/src/app/providers.tsx');
        const { ShareDialog } = await import('/src/features/permissions/share-dialog.tsx');
        const { TeamMemberManager } = await import('/src/features/permissions/team-member-manager.tsx');
        const view = kind === 'share'
          ? React.createElement(ShareDialog, { node: { id: node.id, name: node.name }, onClose: () => {} })
          : React.createElement(TeamMemberManager, { spaceId: space.id, spaceName: space.name, canManage: true, actorRole: 'owner' });
        permissionRoot.render(React.createElement(Providers, { key: kind + mode },
          React.createElement(QueryClientProvider, { client }, view)));
      };
    })()`);
    browser("wait", "--fn", "Boolean(window.permissionCommands)");
    const initialUrl = browser("get", "url").url;
    const result = evaluate(`(async () => {
      const { nodeId, userId, spaceId, owner, guest } = permissionFixture;
      const { grant, removeGrant, link, member, removeMember, client } = permissionCommands;
      const { api } = await import('/src/shared/api/client.ts');
      const requests = [];
      const recorder = { onRequest: async ({ request }) => {
        requests.push({ method: request.method, path: new URL(request.url).pathname,
          body: request.method === 'PUT' ? await request.clone().json() : null });
      }};
      api.use(recorder);
      const keys = [['node-grants', nodeId], ['node-link-sharing', nodeId], ['team-members', spaceId], ['node-grants', 'other']];
      function prime() { for (const key of keys) client.setQueryData(key, null); }
      function expectOnly(index) {
        for (let i = 0; i < keys.length; i++) {
          if (client.getQueryState(keys[i]).isInvalidated !== (i === index)) throw new Error('缓存失效范围错误: ' + keys[i]);
        }
      }
      prime(); await grant.mutateAsync({ nodeId, userId, role: 'viewer' }); expectOnly(0);
      const grants = await permissionRequest('/api/nodes/' + nodeId + '/grants');
      if (!grants.grants.some(g => g.user.id === userId && g.role === 'viewer')) throw new Error('授权未持久化');
      prime(); await link.mutateAsync({ nodeId, enabled: true, role: 'viewer' }); expectOnly(1);
      prime(); await link.mutateAsync({ nodeId, enabled: false, role: 'viewer' }); expectOnly(1);
      prime(); await member.mutateAsync({ spaceId, userId, role: 'editor' }); expectOnly(2);
      prime(); await member.mutateAsync({ spaceId, userId, role: 'viewer' }); expectOnly(2);
      await permissionRequest('/api/auth/password/login', 'POST', guest);
      prime();
      let denied = 0;
      for (const operation of [
        () => grant.mutateAsync({ nodeId, userId, role: 'editor' }),
        () => member.mutateAsync({ spaceId, userId, role: 'admin' }),
      ]) {
        try { await operation(); } catch (error) {
          if (error.name !== 'ApiError' || error.code !== 'FORBIDDEN') throw error;
          denied++;
        }
      }
      if (denied !== 2) throw new Error('服务端权限拒绝未传播');
      expectOnly(-1);
      await permissionRequest('/api/auth/password/login', 'POST', owner);
      prime(); await removeGrant.mutateAsync({ nodeId, userId }); expectOnly(0);
      prime(); await removeMember.mutateAsync({ spaceId, userId }); expectOnly(2);
      const finalGrants = await permissionRequest('/api/nodes/' + nodeId + '/grants');
      const finalMembers = await permissionRequest('/api/team-spaces/' + spaceId + '/members');
      const finalLink = await permissionRequest('/api/nodes/' + nodeId + '/link-sharing');
      if (finalGrants.grants.some(g => g.user.id === userId) ||
          finalMembers.members.some(m => m.user.id === userId) || finalLink.enabled) throw new Error('撤销失败');
      api.eject(recorder);
      return { nodeId, userId, spaceId, requests, url: location.href };
    })()`);
    const { nodeId, userId, spaceId } = result;
    const grantPath = `/api/nodes/${nodeId}/grants/${userId}`;
    const memberPath = `/api/team-spaces/${spaceId}/members/${userId}`;
    assert.deepEqual(result.requests, [
      { method: "PUT", path: grantPath, body: { role: "viewer" } },
      { method: "PUT", path: `/api/nodes/${nodeId}/link-sharing`, body: { enabled: true, role: "viewer" } },
      { method: "PUT", path: `/api/nodes/${nodeId}/link-sharing`, body: { enabled: false, role: "viewer" } },
      { method: "PUT", path: memberPath, body: { role: "editor" } },
      { method: "PUT", path: memberPath, body: { role: "viewer" } },
      { method: "PUT", path: grantPath, body: { role: "editor" } },
      { method: "PUT", path: memberPath, body: { role: "admin" } },
      { method: "DELETE", path: grantPath, body: null },
      { method: "DELETE", path: memberPath, body: null },
    ]);
    assert.equal(result.url, initialUrl);
    for (const mode of ["wiki", "repository"]) {
      for (const kind of ["share", "members"]) {
        evaluate(`renderPermissionView('${kind}', '${mode}')`);
        if (kind === "members" && mode === "repository") {
          browser("wait", "--fn", "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Add')");
          browser("find", "role", "button", "click", "--name", "Add", "--exact");
        }
        browser("wait", 'input[role="combobox"]');
        const guest = evaluate("permissionFixture.guest.username");
        browser("find", "label", "Search users", "fill", guest);
        browser("wait", "--fn", `[...document.querySelectorAll('[role=option]')].some(e => e.textContent.includes('${guest}'))`);
        evaluate(`[...document.querySelectorAll('[role=option]')].find(e => e.textContent.includes('${guest}')).click()`);
        const label = kind === "share" ? "Invite" : "Add";
        evaluate(`[...(document.querySelector('[role=dialog]') ?? document).querySelectorAll('button')].find(b => b.textContent.trim() === '${label}').click()`);
        browser("wait", 'button[aria-label="Remove Permission Guest"]');
        if (kind === "share" || mode === "wiki") {
          assert.equal(evaluate("document.querySelector('input[role=combobox]').value"), "");
        }
        if (kind === "members" && mode === "repository") {
          browser("wait", "--fn", "document.querySelector('[role=dialog]') === null");
        }
        browser("find", "role", "button", "click", "--name", "Remove Permission Guest", "--exact");
        browser("wait", "--fn", `document.querySelector('button[aria-label="Remove Permission Guest"]') === null`);
        if (kind === "share") {
          for (const enabled of [true, false]) {
            browser("find", "role", "switch", "click", "--name", enabled ? "Enable link sharing" : "Disable link sharing", "--exact");
            browser("wait", "--fn", `document.querySelector('[role=switch]').getAttribute('aria-checked') === '${enabled}' && !document.querySelector('[role=switch]').disabled`);
          }
        }
        assert.equal(browser("get", "url").url, initialUrl);
      }
    }
  } finally {
    browser("close");
  }
});
