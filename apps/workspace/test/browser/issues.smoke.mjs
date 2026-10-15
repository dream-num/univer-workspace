// Run against an authenticated English session and a DISPOSABLE local Team Space:
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
  const response = JSON.parse(
    execFileSync("agent-browser", ["--json", ...args], { encoding: "utf8" }),
  );
  assert(response.success, response.error);
  return response.data;
}
const evaluate = (code) => browser("eval", code).result;
const click = (role, name) => {
  if (role === "menuitemradio") browser("wait", '[role="menuitemradio"]');
  return browser("find", "role", role, "click", "--name", name, "--exact");
};
const fill = (name, value) =>
  browser("find", "role", "textbox", "fill", value, "--name", name, "--exact");

browser("set", "viewport", "1440", "1000");
browser("open", url.href);
browser("wait", "--text", "New issue");
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
fill("Search issues", "no-matching-issue-" + Date.now());
browser("press", "Enter");
browser("wait", "--text", "No issues match");
click("button", "Clear search");
browser("wait", "--fn", "!location.search.includes('q=')");

const title = "Browser regression " + Date.now();
click("link", "New issue");
browser("wait", "--text", "Submit new issue");
fill("Title", title);
fill("Description", "### Reproduction\n\nA **Markdown** description.");
click("tab", "Write");
browser("press", "ArrowRight");
assert.equal(
  evaluate('document.querySelector("[role=tab][aria-selected=true]").textContent'),
  "Preview",
);
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
console.log(
  "Issues browser smoke passed: filters, sidebar, empty search, create, preview keyboard, comment, edit, close/reopen.",
);
