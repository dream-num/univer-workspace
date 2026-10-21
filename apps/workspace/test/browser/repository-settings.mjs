// Run against a disposable Workspace server and Vite, never a production origin:
// WORKSPACE_TEST_ORIGIN=http://127.0.0.1:5173 node --test test/browser/repository-settings.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const origin = process.env.WORKSPACE_TEST_ORIGIN;
assert.ok(origin && new URL(origin).hostname === "127.0.0.1", "Use a disposable loopback server");
const session = `settings-check-${process.pid}`;
const username = `settings-${Date.now()}`;
const password = "disposable-settings-check-password";

function browser(...args) {
  const result = JSON.parse(
    execFileSync("agent-browser", ["--session", session, "--json", ...args], { encoding: "utf8" }),
  );
  assert.equal(result.success, true, result.error);
  return result.data;
}
const evaluate = (script) => browser("eval", script).result;
const fill = (label, value) => browser("find", "label", label, "fill", value);
const click = (name) => browser("find", "role", "button", "click", "--name", name, "--exact");
const save = (form) => browser("click", `form[aria-label="${form}"] button[type="submit"]`);
const waitForSave = () =>
  browser(
    "wait",
    "--fn",
    "document.querySelector('#space-name').closest('[aria-busy]').getAttribute('aria-busy') === 'false'",
  );

test("Repository settings save independently, stay on Settings, and persist after reload", () => {
  let createdSpaceId;
  try {
    browser("open", origin);
    browser("wait", "--fn", "document.querySelector('input') !== null");
    const space = evaluate(`(async () => {
      const registered = await fetch('/api/auth/password/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify({ username, displayName: "Settings Review", password })}) });
      if (!registered.ok) throw new Error('Registration failed');
      const response = await fetch('/api/team-spaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'settings-demo', publicRead: false }) });
      if (!response.ok) throw new Error('Repository creation failed');
      localStorage.setItem('univer-workspace-layout-theme', 'repository');
      localStorage.setItem('univer-workspace-language', 'en-US');
      localStorage.setItem('univer-workspace-theme', 'light');
      return response.json();
    })()`);
    createdSpaceId = space.id;
    const settingsUrl = `${origin}/spaces/${space.id}/settings`;
    browser("open", settingsUrl);
    browser("wait", "--text", "Danger Zone");
    browser("set", "viewport", "320", "844");
    assert.equal(
      evaluate(
        "(() => { const panel = document.querySelector('.repository-settings'); return panel.scrollWidth <= panel.clientWidth; })()",
      ),
      true,
      "Settings must not overflow at 320px",
    );
    browser("set", "viewport", "1440", "900");
    fill("Repository name", "   ");
    click("Rename");
    waitForSave();
    browser("wait", "--text", "Enter a repository name.");
    fill("Description", "Unsaved description");
    fill("Repository name", "settings-renamed");
    click("Rename");
    waitForSave();
    browser(
      "wait",
      "--fn",
      "document.querySelector('form[aria-label=\"Repository name\"] button').disabled",
    );
    assert.equal(browser("get", "url").url, settingsUrl);
    assert.equal(
      evaluate("document.querySelector('#space-description').value"),
      "Unsaved description",
    );
    assert.equal(
      evaluate(`fetch('/api/spaces/${space.id}').then(r => r.json()).then(s => s.description)`),
      "",
    );
    save("Description");
    waitForSave();
    browser(
      "wait",
      "--fn",
      "document.querySelector('form[aria-label=\"Description\"] button').disabled",
    );
    click("Change visibility");
    browser("wait", "--text", "Make publicly readable");
    click("Cancel");
    browser("wait", "--fn", "document.querySelector('[role=alertdialog]') === null");
    assert.equal(
      evaluate(`fetch('/api/spaces/${space.id}').then(r => r.json()).then(s => s.publicRead)`),
      false,
    );
    click("Change visibility");
    browser("wait", '[role="alertdialog"]');
    click("Make publicly readable");
    browser("wait", "--text", "This repository currently allows public read-only access.");
    browser("reload");
    browser("wait", "--text", "Danger Zone");
    assert.equal(evaluate("document.querySelector('#space-name').value"), "settings-renamed");
    assert.equal(
      evaluate("document.querySelector('#space-description').value"),
      "Unsaved description",
    );
    assert.equal(
      evaluate(`fetch('/api/spaces/${space.id}').then(r => r.json()).then(s => s.publicRead)`),
      true,
    );

    // A failed request must retain the draft and allow retry.
    browser("network", "route", "**/api/spaces/*", "--abort");
    fill("Description", "Retry this description");
    save("Description");
    waitForSave();
    browser(
      "wait",
      "--fn",
      "!document.querySelector('form[aria-label=\"Description\"] button').disabled",
    );
    assert.equal(
      evaluate("document.querySelector('#space-description').value"),
      "Retry this description",
    );
    browser("network", "unroute", "**/api/spaces/*");
    save("Description");
    waitForSave();
    browser(
      "wait",
      "--fn",
      "document.querySelector('form[aria-label=\"Description\"] button').disabled",
    );
    browser("reload");
    browser("wait", "--text", "Danger Zone");
    assert.equal(
      evaluate("document.querySelector('#space-description').value"),
      "Retry this description",
    );
    // Slug: full name, validation, conflict, save, and lookup through owner/slug.
    browser("wait", "--text", "Full name:");
    assert.equal(evaluate("document.querySelector('#space-slug').value"), "settings-demo");
    assert.equal(
      evaluate(`document.querySelector('form[aria-label="Slug"] code').textContent`),
      `${username}/settings-demo`,
    );
    evaluate(`fetch('/api/team-spaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'other', slug: 'other-slug' }) }).then(r => { if (!r.ok) throw new Error('slug fixture failed'); })`);
    fill("Slug", "bad slug!");
    save("Slug");
    browser("wait", "--text", "A slug starts with a letter or digit");
    fill("Slug", "OTHER-SLUG");
    save("Slug");
    browser("wait", "--text", "You already own a repository with this slug.");
    fill("Slug", "renamed-slug");
    save("Slug");
    browser("wait", "--fn", "document.querySelector('form[aria-label=\"Slug\"] button').disabled");
    assert.equal(
      evaluate(`document.querySelector('form[aria-label="Slug"] code').textContent`),
      `${username}/renamed-slug`,
    );
    assert.equal(
      evaluate(`fetch('/api/spaces/lookup?owner=${username}&slug=RENAMED-SLUG').then(r => r.json()).then(s => s.id)`),
      space.id,
    );
    // The Code tab header and About panel show the full name.
    browser("open", `${origin}/spaces/${space.id}`);
    browser("wait", "--text", `${username}/renamed-slug`);
    // The Star control lives in the Code tab header, so the remaining checks stay on this page.
    // 领域命令保留 Star 乐观更新、失败回滚和重试。
    const starSelector = 'button[aria-label$=" settings-renamed"][aria-pressed]';
    browser("wait", "--fn", `document.querySelector('${starSelector}')?.getAttribute('aria-busy') === 'false'`);
    evaluate(`(async () => {
      const { api } = await import('/src/shared/api/client.ts');
      window.originalStarPut = api.PUT;
      api.PUT = () => new Promise((_, reject) => {
        window.rejectStar = () => reject(new Error('Star test failure'));
      });
    })()`);
    click("Star settings-renamed");
    browser("wait", "--fn", `document.querySelector('${starSelector}')?.getAttribute('aria-pressed') === 'true'`);
    assert.equal(evaluate(`document.querySelector('${starSelector}').getAttribute('aria-busy')`), "true");
    evaluate("window.rejectStar()");
    browser("wait", "--fn", `document.querySelector('${starSelector}')?.getAttribute('aria-busy') === 'false'`);
    assert.equal(evaluate(`document.querySelector('${starSelector}').getAttribute('aria-pressed')`), "false");
    evaluate(`(async () => {
      const { api } = await import('/src/shared/api/client.ts');
      api.PUT = window.originalStarPut;
      delete window.originalStarPut;
      delete window.rejectStar;
    })()`);
    click("Star settings-renamed");
    browser("wait", "--fn", `document.querySelector('${starSelector}')?.getAttribute('aria-busy') === 'false'`);
    assert.equal(evaluate(`fetch('/api/spaces/${space.id}/star').then(r => r.json()).then(s => s.starred)`), true);
    click("Unstar settings-renamed");
    browser("wait", "--fn", `document.querySelector('${starSelector}')?.getAttribute('aria-busy') === 'false'`);
    assert.equal(evaluate(`fetch('/api/spaces/${space.id}/star').then(r => r.json()).then(s => s.starred)`), false);

    // 首页与 wiki 外壳共用创建命令，创建后关闭弹窗并进入新空间。
    for (const mode of ["repository", "wiki"]) {
      evaluate(`localStorage.setItem('univer-workspace-layout-theme', '${mode}')`);
      browser("open", `${origin}/home`);
      browser("wait", "--fn", mode === "repository"
        ? "document.querySelector('main')?.textContent.includes('New repository')"
        : "document.querySelector('button[aria-label=\"Create team space\"]') !== null");
      click(mode === "repository" ? "New repository" : "Create team space");
      browser("wait", "[role=dialog] input");
      const name = `created-via-${mode}`;
      fill(mode === "repository" ? "Repository name" : "Space name", name);
      // The Wiki file browser has no slug field; the server derives the same slug from the name.
      if (mode === "repository") {
        assert.equal(evaluate("document.querySelector('#team-space-slug').value"), name);
      }
      click("Create");
      browser("wait", "--fn", "document.querySelector('[role=dialog]') === null && location.pathname.startsWith('/spaces/')");
      const created = evaluate(`fetch('/api/spaces').then(r => r.json()).then(p => p.spaces.find(s => s.name === '${name}'))`);
      assert.ok(created, "创建后空间列表刷新");
      assert.equal(browser("get", "url").url, `${origin}/spaces/${created.id}`);
      assert.equal(created.publicRead, false);
      assert.equal(created.slug, name);
    }
    // Dialog: a name without usable characters leaves the slug empty (server generates one);
    // a taken slug keeps the dialog open; clearing it lets the server pick the next free one.
    evaluate("localStorage.setItem('univer-workspace-layout-theme', 'repository')");
    browser("open", `${origin}/home`);
    browser("wait", "--fn", "document.querySelector('main')?.textContent.includes('New repository')");
    click("New repository");
    browser("wait", "[role=dialog] input");
    fill("Repository name", "文档");
    assert.equal(evaluate("document.querySelector('#team-space-slug').value"), "");
    click("Create");
    browser("wait", "--fn", "document.querySelector('[role=dialog]') === null && location.pathname.startsWith('/spaces/')");
    assert.match(
      evaluate("fetch('/api/spaces').then(r => r.json()).then(p => p.spaces.find(s => s.name === '文档').slug)"),
      /^repo-[0-9a-f]{8}$/,
    );
    browser("open", `${origin}/home`);
    browser("wait", "--fn", "document.querySelector('main')?.textContent.includes('New repository')");
    click("New repository");
    browser("wait", "[role=dialog] input");
    fill("Repository name", "created-via-repository");
    click("Create");
    browser("wait", "--text", "You already own a repository with this slug.");
    assert.equal(evaluate("document.querySelector('[role=dialog]') !== null"), true);
    fill("Slug", " "); // whitespace trims to empty, so the server picks the next free slug
    click("Create");
    browser("wait", "--fn", "document.querySelector('[role=dialog]') === null && location.pathname.startsWith('/spaces/')");
    assert.equal(
      evaluate("fetch('/api/spaces').then(r => r.json()).then(p => p.spaces.filter(s => s.name === 'created-via-repository').map(s => s.slug).sort().join())"),
      "created-via-repository,created-via-repository-2",
    );
    evaluate("localStorage.setItem('univer-workspace-layout-theme', 'repository')");
    const personalId = evaluate(
      "fetch('/api/spaces').then(r => r.json()).then(p => p.spaces.find(s => s.type === 'personal').id)",
    );
    browser("open", `${origin}/spaces/${personalId}/settings`);
    browser("wait", "--text", "Danger Zone");
    assert.equal(
      evaluate("document.querySelector('nav[aria-label=\"Settings\"] a[href$=members]') === null"),
      true,
      "Personal repositories have no team membership page",
    );
  } finally {
    try {
      if (createdSpaceId) {
        browser("network", "unroute", "**/api/spaces/*");
        evaluate(`fetch('/api/spaces/${createdSpaceId}', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ publicRead: false }),
        }).then(r => { if (!r.ok) throw new Error('测试空间清理失败'); })`);
      }
    } finally {
      browser("close");
    }
  }
});
