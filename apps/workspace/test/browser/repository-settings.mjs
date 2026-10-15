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
const waitForSave = () =>
  browser(
    "wait",
    "--fn",
    "document.querySelector('[aria-busy]').getAttribute('aria-busy') === 'false'",
  );

test("Repository settings save independently, stay on Settings, and persist after reload", () => {
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
    click("Save");
    waitForSave();
    browser(
      "wait",
      "--fn",
      "document.querySelector('form[aria-label=\"Description\"] button').disabled",
    );
    click("Change visibility");
    browser("wait", "--text", "Make publicly readable");
    click("Cancel");
    assert.equal(
      evaluate(`fetch('/api/spaces/${space.id}').then(r => r.json()).then(s => s.publicRead)`),
      false,
    );
    click("Change visibility");
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
    click("Save");
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
    click("Save");
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
    browser("close");
  }
});
