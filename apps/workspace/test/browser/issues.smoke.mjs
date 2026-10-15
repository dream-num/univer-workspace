// Run against a local Vite server, authenticated English session and a DISPOSABLE Team Space:
// WORKSPACE_ISSUES_URL=http://127.0.0.1:5173/spaces/<id>/issues \
// AGENT_BROWSER_SESSION=<your-session> node test/browser/issues.smoke.mjs
// Requires agent-browser on PATH. Creates an Issue and comments; never use production data.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const url = new URL(process.env.WORKSPACE_ISSUES_URL);
assert(["localhost", "127.0.0.1"].includes(url.hostname), "Use a disposable localhost service");
assert.match(url.pathname, /^\/spaces\/[^/]+\/issues\/?$/);
assert(process.env.AGENT_BROWSER_SESSION, "Provide an isolated authenticated browser session");
function browser(...args) {
  const response = JSON.parse(execFileSync("agent-browser", ["--json", ...args], { encoding: "utf8" }));
  assert(response.success, response.error);
  return response.data;
}
const evaluate = (code) => browser("eval", code).result;
const click = (role, name) => {
  if (role === "menuitemradio" || role === "menuitem") browser("wait", `[role="${role}"]`);
  return browser("find", "role", role, "click", "--name", name, "--exact");
};
const fill = (name, value) => browser("find", "role", "textbox", "fill", value, "--name", name, "--exact");

browser("set", "viewport", "1440", "1000");
browser("open", url.href);
browser("wait", "--text", "New issue");
const repository = evaluate("document.documentElement.dataset.uiMode === 'repository'");
if (repository) {
  // Portaled filters must keep the same palette on global and space lists.
  for (const listUrl of [new URL("/issues", url).href, url.href]) {
    browser("open", listUrl);
    browser("wait", "--text", "Author");
    click("button", "Author");
    browser("wait", '[role="menuitemradio"]');
    assert.equal(
      evaluate(`getComputedStyle(document.querySelector('[role="menu"]')).backgroundColor`),
      evaluate(`document.documentElement.classList.contains('dark') ? 'rgb(13, 17, 23)' : 'rgb(255, 255, 255)'`),
    );
    browser("press", "Escape");
    browser("wait", "--fn", `!document.querySelector('[role="menu"]')`);
  }
  assert.equal(evaluate(`document.querySelectorAll('nav[aria-label="Issue filters"]').length`), 1);
  click("link", "Assigned to me");
  browser("wait", "--url", "**assignee=me*");
  assert.equal(new URL(browser("get", "url").url).searchParams.get("assignee"), "me");
  click("button", "Clear filters");
  browser("wait", "--fn", "!location.search.includes('assignee')");
  click("button", "Author");
  click("menuitemradio", "Created by me");
  browser("wait", "--url", "**author=me*");
  click("button", "Clear filters");
  browser("wait", "--fn", "!location.search.includes('author')");
  click("button", "Newest");
  click("menuitemradio", "Oldest");
  browser("wait", "--url", "**order=asc*");
  click("button", "Oldest");
  click("menuitemradio", "Newest");
  browser("wait", "--fn", "!location.search.includes('order')");
  click("button", "Collapse sidebar");
  assert.equal(evaluate(`document.querySelectorAll('nav[aria-label="Issue filters"]').length`), 0);
  click("button", "Expand sidebar");
  assert.equal(evaluate(`document.querySelectorAll('nav[aria-label="Issue filters"]').length`), 1);
}
fill("Search issues", "no-matching-issue-" + Date.now());
browser("press", "Enter");
browser("wait", "--text", "No issues match");
click("button", "Clear search");
browser("wait", "--fn", "!location.search.includes('q=')");

const recordWrites = () =>
  evaluate(`(async () => {
  const { api } = await import('/src/shared/api/client.ts');
  window.issueWrites = [];
  api.use({ onRequest: async ({ request }) => {
    if (request.method !== 'GET') {
      const text = await request.clone().text();
      issueWrites.push({ method: request.method, path: new URL(request.url).pathname, body: text ? JSON.parse(text) : null });
    }
  }});
})()`);
recordWrites();
const title = "Browser regression " + Date.now();
click("link", "New issue");
browser("wait", "--text", "Submit new issue");
fill("Title", title);
fill("Description", "### Reproduction\n\nA **Markdown** description.");
click("tab", "Write");
browser("press", "ArrowRight");
assert.equal(evaluate('document.querySelector("[role=tab][aria-selected=true]").textContent'), "Preview");
assert.equal(evaluate('document.querySelector("[role=tabpanel] strong").textContent'), "Markdown");
browser("press", "ArrowLeft");
click("button", "Submit new issue");
browser("wait", "--url", "**/issues/*");
browser("wait", "--text", title);
assert.match(browser("get", "url").url, /\/issues\/\d+$/);
fill("Add a comment", "Regression comment");
click("button", "Comment");
browser("wait", "--text", "Regression comment");
assert.equal(evaluate(`document.querySelector('textarea[aria-label="Add a comment"]').value`), "");
click("button", "Edit");
fill("Title", title + " edited");
click("button", "Save");
browser("wait", "--text", title + " edited");
click("button", "Close issue");
browser("wait", "--fn", "document.querySelector('.issue-state-badge').dataset.state === 'closed'");
click("button", "Reopen issue");
browser("wait", "--fn", "document.querySelector('.issue-state-badge').dataset.state === 'open'");
assert.equal(evaluate('document.querySelectorAll(".issue-comment").length'), 2);
const detailUrl = browser("get", "url").url;
browser("click", "section[aria-label=Activity] .issue-comment button[aria-label='More actions']");
click("menuitem", "Edit");
fill("Comment", "Edited regression comment");
click("button", "Save");
browser("wait", "--text", "Edited regression comment");
assert.equal(evaluate(`document.querySelector('textarea[aria-label="Comment"]') === null`), true);
browser("click", "section[aria-label=Activity] .issue-comment button[aria-label='More actions']");
click("menuitem", "Remove");
browser("wait", "[role=alertdialog]");
browser("click", "[role=alertdialog] button:last-child");
browser("wait", "--fn", "document.querySelectorAll('.issue-comment').length === 1");
assert.equal(browser("get", "url").url, detailUrl);
const writes = evaluate("issueWrites");
const issuePath = new URL(detailUrl).pathname.replace("/spaces/", "/api/spaces/");
assert.deepEqual(writes.slice(0, 5), [
  {
    method: "POST",
    path: url.pathname.replace("/spaces/", "/api/spaces/").replace(/\/$/, ""),
    body: { title, body: "### Reproduction\n\nA **Markdown** description." },
  },
  { method: "POST", path: issuePath + "/comments", body: { body: "Regression comment" } },
  { method: "PATCH", path: issuePath, body: { title: title + " edited" } },
  { method: "PATCH", path: issuePath, body: { state: "closed", stateReason: "completed" } },
  { method: "PATCH", path: issuePath, body: { state: "open" } },
]);
assert.equal(writes.length, 7);
assert.match(writes[5].path, /^\/api\/issue-comments\/[^/]+$/);
assert.deepEqual(writes[5], { method: "PATCH", path: writes[5].path, body: { body: "Edited regression comment" } });
assert.deepEqual(writes[6], { method: "DELETE", path: writes[5].path, body: null });

browser("open", url.href.replace(/\/$/, "") + "/labels");
browser("wait", "--text", "New label");
recordWrites();
const label = "Regression label " + Date.now();
click("button", "New label");
fill("Name", label);
fill("Description", "Label description");
click("button", "Save");
browser("wait", "--fn", "!document.querySelector('[role=dialog]')");
click("button", "New label");
fill("Name", label);
click("button", "Save");
browser("wait", "#issue-label-name[aria-invalid=true]");
assert.equal(evaluate("document.querySelector('#issue-label-name').value"), label);
click("button", "Cancel");
browser("wait", "--fn", "!document.querySelector('[role=dialog], [data-ending-style]')");
click("button", "Edit label " + label);
fill("Name", label + " edited");
click("button", "Save");
browser("wait", "--fn", "!document.querySelector('[role=dialog]')");
click("button", "Delete label " + label + " edited");
browser("wait", "[role=alertdialog]");
browser("click", "[role=alertdialog] button:last-child");
browser("wait", "--fn", `!document.querySelector('button[aria-label="Delete label ${label} edited"]')`);
const labelWrites = evaluate("issueWrites");
assert.equal(labelWrites.length, 4);
assert.deepEqual(labelWrites[0], {
  method: "POST",
  path: url.pathname.replace("/spaces/", "/api/spaces/").replace(/\/issues\/?$/, "/issue-labels"),
  body: { name: label, color: "blue", description: "Label description" },
});
assert.deepEqual(labelWrites[1], {
  method: "POST",
  path: labelWrites[0].path,
  body: { name: label, color: "blue", description: "" },
});
assert.match(labelWrites[2].path, /^\/api\/issue-labels\/[^/]+$/);
assert.deepEqual(labelWrites[2], {
  method: "PATCH",
  path: labelWrites[2].path,
  body: { name: label + " edited", color: "blue", description: "Label description" },
});
assert.deepEqual(labelWrites[3], { method: "DELETE", path: labelWrites[2].path, body: null });
assert.equal(browser("get", "url").url, url.href.replace(/\/$/, "") + "/labels");
console.log(
  "Issues browser smoke passed: filters, create, comments, close/reopen, labels, write contracts and final URLs.",
);
