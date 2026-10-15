// Run with a disposable Workspace server/Vite and agent-browser installed:
// WORKSPACE_TEST_ORIGIN=http://127.0.0.1:5173 node --test apps/workspace/test/browser/repository-pages.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const origin = process.env.WORKSPACE_TEST_ORIGIN;
assert.ok(origin && new URL(origin).hostname === "127.0.0.1", "Use a disposable loopback server");
const session = `pages-check-${process.pid}`;
function browser(...args) {
  const result = JSON.parse(
    execFileSync("agent-browser", ["--session", session, "--json", ...args], { encoding: "utf8" }),
  );
  assert.equal(result.success, true, result.error);
  return result.data;
}
const evaluate = (script) => browser("eval", script).result;
function waitForPage() {
  // The SDK owns the iframe inside a shadow root; document.querySelector cannot see it.
  browser(
    "wait",
    "--fn",
    "[...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('iframe'))",
  );
  assert.match(
    browser("snapshot").snapshot,
    /heading "Page content"/,
    "The HTML page must render its content",
  );
}

test("Pages keeps navigation, page links, local defaults, copying, and narrow-screen access", () => {
  try {
    browser("open", origin);
    const space = evaluate(`(async () => {
      const post = async (url, body) => {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(url + ': ' + response.status);
        return response.json();
      };
      await post('/api/auth/password/register', { username: 'pages-' + Date.now(), displayName: 'Pages Test', password: 'disposable-pages-test-password' });
      const space = await post('/api/team-spaces', { name: 'pages-check', publicRead: false });
      for (const name of ['Handbook', 'Report']) {
        const content = '<!doctype html><html><head><title>' + name + '</title></head><body><h1>' + name + '</h1><a href="#details">Details</a><h2 id="details">Page content</h2></body></html>';
        const upload = await post('/api/blob-upload-sessions', { spaceId: space.id, parentNodeId: null, name: name + '.univer.html', originalFilename: name + '.univer.html', byteSize: new TextEncoder().encode(content).length, declaredMediaType: 'text/html' });
        const response = await fetch(upload.uploadTarget.contentUrl, { method: 'PUT', body: content });
        if (!response.ok) throw new Error('Upload failed');
        await post('/api/blob-upload-sessions/' + upload.upload.id + '/complete');
      }
      localStorage.setItem('univer-workspace-layout-theme', 'repository');
      localStorage.setItem('univer-workspace-language', 'en-US');
      localStorage.setItem('univer-workspace-theme', 'light');
      return space;
    })()`);
    browser("open", `${origin}/spaces/${space.id}`);
    browser("wait", 'nav[aria-label="Repository"] a[href$="view=apps"]');
    browser("click", 'nav[aria-label="Repository"] a[href$="view=apps"]');
    browser("wait", "--text", "2 pages.");
    assert.equal(
      evaluate(
        `(() => { const links = [...document.querySelectorAll('nav[aria-label="Repository"] a')]; const index = links.findIndex(a => a.textContent === 'Pages'); return links[index - 1].textContent.trim() === 'Pull requests' && links[index].getAttribute('aria-current') === 'page'; })()`,
      ),
      true,
    );
    const heading = "#repository-pages-heading";
    assert.equal(evaluate(`document.querySelector('${heading}').textContent.trim()`), "Pages");
    const section = 'section[aria-labelledby="repository-pages-heading"]';
    const links = evaluate(
      `Array.from(document.querySelectorAll('${section} li a')).map(a => a.href)`,
    );
    assert.equal(links.length, 2);
    assert.equal(evaluate(`document.querySelectorAll('${section} li p').length`), 2);
    const oldDefault = evaluate(`document.querySelector('${section} code').textContent`);
    browser("focus", `${section} li button`);
    browser("press", "Enter");
    const newDefault = evaluate(`document.querySelector('${section} code').textContent`);
    assert.notEqual(newDefault, oldDefault);
    browser("reload");
    browser("wait", "--text", "2 pages.");
    assert.equal(evaluate(`document.querySelector('${section} code').textContent`), newDefault);
    assert.equal(evaluate(`document.querySelector('${section} a.inline-flex').href`), newDefault);
    // Clipboard writes are observed without depending on OS clipboard permissions.
    evaluate(
      `Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.__copiedPage = text; } })`,
    );
    browser("find", "role", "button", "click", "--name", "Copy address", "--exact");
    assert.equal(evaluate("window.__copiedPage"), newDefault);
    browser("wait", "--text", "Page address copied.");
    evaluate(
      `Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('Clipboard denied'); } })`,
    );
    browser("find", "role", "button", "click", "--name", "Copy address", "--exact");
    browser("wait", "--text", "Unable to copy the page address.");
    for (const width of [320, 768, 1024, 1440]) {
      browser("set", "viewport", String(width), "900");
      assert.equal(
        evaluate(
          `(() => { const panel = document.querySelector('.repository-pages'); return panel.scrollWidth <= panel.clientWidth && document.documentElement.scrollWidth <= innerWidth; })()`,
        ),
        true,
        `Overflow at ${width}px`,
      );
    }
    browser("find", "role", "link", "click", "--name", "Visit page", "--exact");
    browser("wait", "--url", "**/nodes/**?view=immersive");
    waitForPage();
    assert.equal(browser("get", "url").url, newDefault);
    for (const url of links) {
      browser("open", url);
      waitForPage();
      assert.equal(browser("get", "url").url, url);
    }
    const empty = evaluate(
      `fetch('/api/team-spaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'empty-pages', publicRead: false }) }).then(r => { if (!r.ok) throw new Error('Create failed'); return r.json(); })`,
    );
    browser("open", `${origin}/spaces/${empty.id}?view=apps`);
    browser("wait", "--text", "No pages yet");
    assert.equal(evaluate(`document.querySelectorAll('${section} button').length`), 0);
  } finally {
    browser("close");
  }
});
