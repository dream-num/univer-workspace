// 仅连接可丢弃的本地 Server + Vite；夹具和基线需要一起保留。
// WORKSPACE_TEST_ORIGIN=http://127.0.0.1:5173 UI_MODES_UPDATE=1 node --test test/browser/ui-modes.smoke.mjs
// 去掉 UI_MODES_UPDATE 再运行即可比较；也支持直接 node 本文件 --update-baseline。
// UI_MODES_BASELINE_DIR 默认 os.tmpdir()/univer-workspace-ui-modes，自定义时也应放在仓库外。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const origin = process.env.WORKSPACE_TEST_ORIGIN;
assert.ok(origin && new URL(origin).hostname === "127.0.0.1", "只允许可丢弃的 loopback 服务");
const MODES = ["wiki", "repository"];
const baseline = resolve(
  process.env.UI_MODES_BASELINE_DIR ?? join(tmpdir(), "univer-workspace-ui-modes"),
);
const update = process.env.UI_MODES_UPDATE === "1" || process.argv.includes("--update-baseline");
// T4a 移动前补录打开态，保留已有页面基线不变。
const updateOverlays = process.env.UI_MODES_UPDATE_OVERLAYS === "1";
const updatesCapture = (slug) => update
  || (updateOverlays && ["account-open", "settings-open"].includes(slug))
  || (process.env.UI_MODES_UPDATE_COLLAPSED === "1" && slug === "sidebar-collapsed");
const session = `ui-modes-${process.pid}`;
const fixturePath = join(baseline, "fixture.json");
const actual = join(baseline, "actual");
const password = "disposable-ui-modes-password";
const teamName = "ui-modes-team";
const createdName = "Created via UI";

function browser(...args) {
  const result = JSON.parse(
    execFileSync("agent-browser", ["--session", session, "--json", ...args], {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
  assert.equal(result.success, true, result.error);
  return result.data;
}
const evaluate = (script) => browser("eval", script).result;
const click = (role, name) => browser("find", "role", role, "click", "--name", name, "--exact");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });

async function pageRequest(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}
const request = (path, method = "GET", body) =>
  evaluate(
    `(${pageRequest})(${JSON.stringify(path)}, ${JSON.stringify(method)}, ${JSON.stringify(body)})`,
  );

function settle() {
  browser("wait", "main");
  // 复用 Vite 中的 QueryClient，等查询完成后再等 DOM 安静，避免截图捕获骨架或异步侧栏。
  evaluate(`(async () => {
    const { queryClient } = await import('/src/app/providers.tsx');
    const deadline = Date.now() + 20000;
    while (queryClient.isFetching() || queryClient.isMutating()) {
      if (Date.now() > deadline) throw new Error('页面查询未完成');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const failures = queryClient.getQueryCache().getAll().filter(q => q.state.status === 'error');
    if (failures.length) throw new Error('查询失败: ' + failures.map(q => JSON.stringify(q.queryKey)).join(', '));
    await document.fonts.ready;
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { observer.disconnect(); reject(new Error('DOM 未稳定')); }, 10000);
      let quiet;
      const done = () => { clearTimeout(deadline); observer.disconnect(); resolve(); };
      const observer = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(done, 300); });
      observer.observe(document.querySelector('.workspace-shell'), { subtree: true, childList: true, characterData: true });
      quiet = setTimeout(done, 300);
    });
  })()`);
  // 文件树还维护自己的分支状态；QueryClient 空闲时 React 可能尚未完成分支渲染。
  browser("wait", "--fn", "document.querySelector('aside [class*=spinner]') === null");
}

function open(path) {
  browser("open", `${origin}${path}`);
  settle();
  if (path.startsWith("/nodes/") && path.endsWith(fixture.sheetId)) {
    browser(
      "wait",
      "--fn",
      "document.querySelectorAll('.univer-editor-container canvas').length > 0 && !document.querySelector('.univer-editor-shell > .absolute.inset-0')",
    );
    settle();
  }
}

function compareJson(mode, slug, value) {
  const name = `${slug}.json`;
  writeJson(join(actual, mode, name), value);
  if (updatesCapture(slug)) writeJson(join(baseline, mode, name), value);
  else assert.deepEqual(value, json(join(baseline, mode, name)), `${mode}/${name}`);
}

function capture(mode, slug, path, mobile = false, prepare) {
  open(path);
  prepare?.();
  const value = evaluate(`(() => {
    const visible = selector => [...document.querySelectorAll(selector)].filter(e => e.getClientRects().length > 0);
    return {
      url: location.href,
      title: document.title,
      aside: visible('aside').length > 0,
      sidebar: visible('aside nav[aria-label="Main navigation"]').length > 0,
      tabs: visible('nav[aria-label="Repository"]').map(e => e.innerText),
      mainHeadings: visible('main h1').map(e => e.textContent.trim()),
      headerHeadings: visible('header h1').map(e => e.textContent.trim()),
      breadcrumbs: visible('nav[aria-label="Breadcrumb"]').map(e => e.innerText),
    };
  })()`);
  assert.equal(value.url, `${origin}${path}`, `${mode}/${slug} 最终 URL`);
  if (mode === "wiki" && !mobile) assert.equal(value.sidebar, true, `${slug} wiki 侧栏`);
  if (mode === "repository" && slug === "team")
    assert.equal(value.tabs.length, 1, "repository tab 栏");
  compareJson(mode, slug, value);
  // 时间和动画不属于本轮视觉回归；保留 time 元素本身的样式与布局。
  evaluate(`(() => {
    document.querySelectorAll('time').forEach(e => { e.textContent = 'Jan 1, 2026'; });
    const style = document.createElement('style');
    style.textContent = '* { animation: none !important; transition: none !important; caret-color: transparent !important; }';
    document.head.append(style);
    document.activeElement?.blur();
  })()`);
  browser("mouse", "move", "0", "0");
  if (updatesCapture(slug)) browser("screenshot", join(baseline, mode, `${slug}.png`), "--full");
  else {
    browser("screenshot", join(actual, mode, `${slug}.png`), "--full");
    const diff = browser(
      "diff",
      "screenshot",
      "--baseline",
      join(baseline, mode, `${slug}.png`),
      "--output",
      join(actual, mode, `${slug}.diff.png`),
      "--full",
      "--threshold",
      "0",
    );
    assert.equal(diff.differentPixels, 0, `${mode}/${slug} 截图差异: ${JSON.stringify(diff)}`);
    assert.equal(diff.dimensionMismatch, null, `${mode}/${slug} 截图尺寸`);
  }
}

function recordWrite(mode, slug, method, path, action, expectedUrl, expectedBody) {
  const harPath = join(actual, mode, `${slug}.har`);
  browser("network", "har", "start", "--content", "all");
  try {
    action();
    settle();
    assert.equal(browser("get", "url").url, expectedUrl, `${mode}/${slug} 成功后的 URL`);
  } finally {
    browser("network", "har", "stop", harPath);
  }
  const writes = json(harPath).log.entries.filter(
    (e) => e.request.method === method && new URL(e.request.url).pathname === path,
  );
  assert.equal(writes.length, 1, `${mode}/${slug} 应只有一次 ${method} ${path}`);
  const entry = writes[0];
  assert.ok(
    entry.response.status >= 200 && entry.response.status < 300,
    `${slug} HTTP ${entry.response.status}`,
  );
  const body = JSON.parse(entry.request.postData.text);
  assert.deepEqual(body, expectedBody, `${mode}/${slug} 请求内容`);
  compareJson(mode, slug, {
    method,
    path,
    bodyFields: Object.keys(body).sort(),
    body,
    url: expectedUrl,
  });
  if (update)
    writeFileSync(join(baseline, mode, `${slug}.har`), readFileSync(harPath), { mode: 0o600 });
}

function cleanupFolder() {
  const nodes = request(`/api/spaces/${fixture.teamId}/nodes`).nodes;
  for (const node of nodes.filter((n) => n.name === createdName)) {
    assert.equal(node.resource, null, "只能清理本脚本创建的文件夹");
    const batch = request(`/api/nodes/${node.id}/trash`, "POST");
    request(`/api/trash-batches/${batch.id}`, "DELETE");
  }
}

let fixture;
test("UI mode 页面、移动端截图及写操作与基线一致", { timeout: 600_000 }, () => {
  mkdirSync(actual, { recursive: true, mode: 0o700 });
  if (!existsSync(fixturePath)) assert.ok(update, "缺少基线；先用 UI_MODES_UPDATE=1 运行");
  try {
    browser("open", origin);
    if (existsSync(fixturePath)) {
      fixture = json(fixturePath);
      assert.equal(fixture.origin, origin, "夹具 origin 必须与当前服务一致");
      request("/api/auth/password/login", "POST", { username: fixture.username, password });
    } else {
      const username = `ui-modes-${Date.now()}`;
      request("/api/auth/password/register", "POST", {
        username,
        displayName: "UI Modes",
        password,
      });
      const team = request("/api/team-spaces", "POST", { name: teamName, publicRead: false });
      const folder = request("/api/nodes", "POST", {
        spaceId: team.id,
        parentNodeId: null,
        name: "Baseline folder",
      });
      const created = request("/api/resources", "POST", {
        kind: "univer",
        spaceId: team.id,
        parentNodeId: null,
        name: "Baseline sheet",
        unitType: "sheet",
      });
      const result = evaluate(`(async () => {
        const request = ${pageRequest};
        for (let attempt = 0; attempt < 100; attempt++) {
          const operation = await request('/api/operations/${created.operation.id}');
          if (operation.state === 'completed') return operation.result;
          if (operation.state === 'failed') throw new Error(JSON.stringify(operation.error));
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('创建 Sheet 超时');
      })()`);
      const personal = request("/api/spaces").spaces.find((s) => s.type === "personal");
      fixture = {
        origin,
        username,
        teamId: team.id,
        personalId: personal.id,
        folderId: folder.id,
        sheetId: result.nodeId,
      };
      writeJson(fixturePath, fixture);
    }
    request(`/api/spaces/${fixture.teamId}`, "PATCH", { name: teamName });
    cleanupFolder();
    const team = `/spaces/${fixture.teamId}`;
    const pages = [
      ["home", "/home"],
      ["home-shared", "/home?view=shared"],
      ["team", team],
      ["team-prs", `${team}?view=prs`],
      ["team-apps", `${team}?view=apps`],
      ["personal", `/spaces/${fixture.personalId}`],
      ["folder", `/nodes/${fixture.folderId}`],
      ["sheet", `/nodes/${fixture.sheetId}`],
      ["settings", `${team}/settings`],
      ["members", `${team}/members`],
      ["trash", `${team}/trash`],
      ["issues", `${team}/issues`],
      ["worktrees", "/worktrees"],
      ["worktrees-team", `/worktrees?spaceId=${fixture.teamId}`],
      ["apps", "/apps"],
    ];
    for (const mode of MODES) {
      mkdirSync(join(baseline, mode), { recursive: true, mode: 0o700 });
      mkdirSync(join(actual, mode), { recursive: true, mode: 0o700 });
      evaluate(
        `localStorage.clear(); localStorage.setItem('univer-workspace-layout-theme', '${mode}'); localStorage.setItem('univer-workspace-language', 'en-US'); localStorage.setItem('univer-workspace-theme', 'light');`,
      );
      browser("set", "viewport", "1440", "900");
      // 先打开 Sheet，使第一次运行的 Recent 列表与后续运行相同。
      open(`/nodes/${fixture.sheetId}`);
      for (const [slug, path] of pages) capture(mode, slug, path);
      capture(mode, "account-open", "/home", false, () => {
        click("button", "Account");
        browser("wait", "[role=menu]");
      });
      capture(mode, "settings-open", "/home", false, () => {
        if (mode === "repository") {
          click("button", "Account");
          browser("wait", "[role=menu]");
          click("menuitem", "Application settings");
        } else click("button", "Application settings");
        browser("wait", "[role=dialog]");
      });
      capture(mode, "sidebar-collapsed", "/apps", false, () => {
        click("button", "Collapse main navigation");
        browser("wait", "button[aria-label='Expand main navigation']");
      });
      click("button", "Expand main navigation");
      browser("set", "viewport", "390", "844");
      for (const [slug, path] of pages.filter(([slug]) => ["home", "team"].includes(slug))) {
        capture(mode, `${slug}-mobile`, path, true);
      }
      browser("set", "viewport", "1440", "900");
      open(`${team}/settings`);
      recordWrite(
        mode,
        "rename",
        "PATCH",
        `/api/spaces/${fixture.teamId}`,
        () => {
          browser("fill", "#space-name", "ui-modes-renamed");
          click("button", mode === "wiki" ? "Save" : "Rename");
          if (mode === "wiki") browser("wait", "--url", `${origin}${team}`);
          else
            browser(
              "wait",
              "--fn",
              "document.querySelector('form[aria-label=\"Repository name\"] button').disabled",
            );
        },
        `${origin}${team}${mode === "wiki" ? "" : "/settings"}`,
        mode === "wiki"
          ? { name: "ui-modes-renamed", publicRead: false, description: "" }
          : { name: "ui-modes-renamed" },
      );
      request(`/api/spaces/${fixture.teamId}`, "PATCH", { name: teamName });
      open(team);
      try {
        recordWrite(
          mode,
          "create-folder",
          "POST",
          "/api/nodes",
          () => {
            browser("click", 'main button[aria-haspopup="menu"]');
            browser("wait", '[role="menuitem"]');
            click("menuitem", "Group");
            browser("wait", '[role="dialog"] input');
            browser("find", "label", "Group name", "fill", createdName);
            click("button", "Create");
            browser("wait", "--fn", "!document.querySelector('[role=dialog]')");
            browser("wait", "--text", createdName);
          },
          `${origin}${team}`,
          { spaceId: fixture.teamId, parentNodeId: null, name: createdName },
        );
      } finally {
        cleanupFolder();
      }
      console.log(`${mode}: 20 张截图、2 个写操作通过`);
    }
    open("/home");
    for (const nextMode of ["wiki", "repository", "wiki"]) {
      const currentMode = evaluate("document.documentElement.dataset.uiMode");
      if (currentMode === "wiki" && !evaluate("document.querySelector('header input') !== null")) click("button", "Search content on this page");
      browser("fill", currentMode === "repository" ? "main input" : "header input", "mode-reset-probe");
      if (currentMode === "repository") {
        click("button", "Account");
        browser("wait", "[role=menu]");
        click("menuitem", "Application settings");
      } else click("button", "Application settings");
      browser("wait", "[role=dialog]");
      evaluate(`(async () => {
        const { queryClient } = await import('/src/app/providers.tsx');
        window.modeSwitchClient = queryClient;
        queryClient.setQueryData(['mode-switch-probe'], 'retained');
        window.previousModeMain = document.querySelector('main');
      })()`);
      click("button", nextMode === "wiki" ? "Wiki" : "Repository (experimental)");
      browser("wait", "--fn", `document.documentElement.dataset.uiMode === '${nextMode}' && !document.querySelector('[role=dialog]')`);
      settle();
      assert.equal(evaluate("previousModeMain.isConnected"), false, "切换 mode 必须重新挂载 shell");
      if (nextMode === "wiki") click("button", "Search content on this page");
      assert.equal(evaluate(`document.querySelector('${nextMode === "repository" ? "main input" : "header input"}').value`), "", "首页搜索在切换后重置");
      assert.equal(evaluate("localStorage.getItem('univer-workspace-layout-theme')"), nextMode);
      assert.equal(browser("get", "url").url, `${origin}/home`);
      assert.equal(evaluate("document.title"), json(join(baseline, nextMode, "home.json")).title);
      assert.equal(evaluate(`(async () => {
        const { queryClient } = await import('/src/app/providers.tsx');
        return queryClient === modeSwitchClient && queryClient.getQueryData(['mode-switch-probe']) === 'retained';
      })()`), true, "切换 mode 不重建产品缓存");
    }
    console.log("mode 往返切换：shell 重挂载、弹窗关闭、URL、标题、storage 与缓存检查通过");
    // 每类页面写入临时表单状态，再经设置往返切换，验证页面状态随 mode 重挂载。
    const switchPageMode = (nextMode) => {
      if (evaluate("document.documentElement.dataset.uiMode") === "repository") {
        click("button", "Account");
        browser("wait", "[role=menu]");
        click("menuitem", "Application settings");
      } else click("button", "Application settings");
      browser("wait", "[role=dialog]");
      click("button", nextMode === "wiki" ? "Wiki" : "Repository (experimental)");
      browser("wait", "--fn", `document.documentElement.dataset.uiMode === '${nextMode}' && !document.querySelector('[role=dialog]')`);
      settle();
    };
    const resetCases = [
      ["space", team, 'main input[aria-label="Go to file"]'],
      ["folder", `/nodes/${fixture.folderId}`, 'main input[aria-label="Go to file"]'],
      ["settings", `${team}/settings`, "#space-name"],
      ["members", `${team}/members`, 'main input[aria-label="Find a collaborator"]'],
      ["trash", `${team}/trash`, 'main input[aria-label="Search items in Trash"]'],
      ["worktrees", "/worktrees", "header input", "Search tasks, documents, or creators"],
      ["space-worktrees", `/worktrees?spaceId=${fixture.teamId}`, "header input", "Search tasks, documents, or creators"],
    ];
    switchPageMode("repository");
    for (const [name, path, selector, searchLabel] of resetCases) {
      open(path);
      if (searchLabel) click("button", searchLabel);
      browser("wait", selector);
      const initial = evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
      browser("fill", selector, "mode-reset-probe");
      switchPageMode("wiki");
      assert.equal(browser("get", "url").url, `${origin}${path}`);
      switchPageMode("repository");
      assert.equal(browser("get", "url").url, `${origin}${path}`);
      if (searchLabel) click("button", searchLabel);
      browser("wait", selector);
      assert.equal(evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), initial, `${name} 临时状态必须重置`);
      assert.deepEqual(browser("errors").errors, [], `${name} 切换后无未捕获错误`);
      console.log(`${name}: mode 往返切换保持 URL 并清理临时状态`);
    }

  } finally {
    browser("close");
  }
});
