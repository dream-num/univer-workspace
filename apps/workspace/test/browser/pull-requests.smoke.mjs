// Use ONLY test/fixtures/pull-requests-server.ts's disposable service and an
// authenticated English repository browser session. Mutates fixture Worktrees.
// WORKSPACE_PR_FIXTURE=<session.json> AGENT_BROWSER_SESSION=<session> node test/browser/pull-requests.smoke.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const info = JSON.parse(readFileSync(process.env.WORKSPACE_PR_FIXTURE, "utf8"));
assert.equal(info.username, "repo-review");
assert.equal(new URL(info.origin).hostname, "127.0.0.1");
assert(process.env.AGENT_BROWSER_SESSION);
function browser(...args) {
  const result = JSON.parse(
    execFileSync("agent-browser", ["--json", ...args], { encoding: "utf8" }),
  );
  assert(result.success, result.error);
  return result.data;
}
const click = (role, name) => browser("find", "role", role, "click", "--name", name, "--exact");
const evaluate = (code) => browser("eval", code).result;
const listUrl = `${info.origin}/spaces/${info.spaceId}?view=prs`;
browser("set", "viewport", "1440", "1000");
browser("open", listUrl);
browser("wait", "--text", "All pull requests");
browser("wait", "--text", "Update quarterly forecast and planning notes");
assert.equal(
  evaluate(`document.querySelector('button[aria-pressed="true"]').textContent.includes('Open')`),
  true,
);
click("link", "Update quarterly forecast and planning notes");
browser("wait", "--text", "Overview");
assert.equal(
  evaluate(`document.querySelector('.repository-pull-requests h1').textContent`),
  "Update quarterly forecast and planning notes",
);
click("link", "Files changed 2");
browser("wait", "--url", "**section=files*");
browser("wait", "iframe[title='Quarterly forecast preview']");
browser("find", "role", "link", "click", "--name", "Planning notes");
browser("wait", "iframe[title='Planning notes preview']");
click("button", "Compare");
browser("wait", "--url", "**view=comparison*");
browser("wait", "--text", "Official version");
browser("wait", "--text", "Snapshot comparison");
browser("wait", "--fn", "document.querySelector('.repository-pull-requests canvas') !== null");
browser("reload");
browser("wait", "--text", "Official version");
browser("wait", "--fn", "document.querySelector('.repository-pull-requests canvas') !== null");
click("button", "View");
browser("wait", "iframe[title='Planning notes preview']");
click("link", "Overview");
browser("wait", "--text", "Review the agent draft");
click("button", "Confirm merge");
click("button", "Cancel");
browser("wait", "--fn", `document.querySelectorAll('[role="alertdialog"]').length === 0`);

browser(
  "open",
  `${info.origin}/worktrees?spaceId=${info.spaceId}&worktree=${info.tasks.draft}&section=files`,
);
browser("wait", "--text", "Mark for deletion");
click("button", "Mark for deletion");
browser("wait", "--text", "Undo deletion");
click("button", "Undo deletion");
browser("wait", "--text", "Mark for deletion");
click("button", "Submit for review");
click("button", "Cancel");
browser("wait", "--fn", `document.querySelectorAll('[role="alertdialog"]').length === 0`);
click("link", "Overview");
browser("wait", "--text", "Draft launch checklist");
click("button", "Submit for review");
// Confirm buttons share their name with the trigger; scope to the dialog.
browser("click", '[role="alertdialog"] button:last-child');
browser("wait", "--text", "Confirm merge");
browser("wait", "--fn", `document.querySelectorAll('[role="alertdialog"]').length === 0`);
click("button", "Confirm merge");
browser("click", '[role="alertdialog"] button:last-child');
browser("wait", "--fn", "document.querySelector('[data-pr-state]').dataset.prState === 'merged'");

browser("open", `${info.origin}/worktrees?spaceId=${info.spaceId}&worktree=${info.tasks.long}`);
browser("wait", "--text", "Discard changes");
click("button", "Discard changes");
browser("click", '[role="alertdialog"] button:last-child');
browser(
  "wait",
  "--fn",
  "document.querySelector('[data-pr-state]').dataset.prState === 'discarded'",
);
browser("open", `${info.origin}/worktrees?spaceId=${info.spaceId}&worktree=${info.tasks.empty}`);
browser("wait", "--text", "The agent has not produced any documents yet");

browser(
  "open",
  `${info.origin}/worktrees?spaceId=${info.spaceId}&worktree=${info.tasks.ready}&section=files&unit=missing`,
);
browser("wait", "--text", "The task document specified by this link could not be found.");

browser("open", listUrl);
browser("wait", "--text", "All pull requests");
click("button", "Closed 4");
browser("wait", "--text", "Publish the approved quarterly plan");
browser("find", "role", "textbox", "fill", "no-matching-pr", "--name", "Search pull requests");
browser("wait", "--text", "No pull requests match");
click("button", "Clear search");
browser("wait", "--text", "Publish the approved quarterly plan");
for (const width of [320, 768, 1024, 1440]) {
  browser("set", "viewport", String(width), "1000");
  assert(evaluate("document.documentElement.scrollWidth <= innerWidth"), `Overflow at ${width}px`);
}

// Inject only UI states; these do not claim to test the SDK's merge algorithm.
const detailUrl = `${info.origin}/api/worktrees/${info.tasks.ready}`;
const detailPage = `${info.origin}/worktrees?spaceId=${info.spaceId}&worktree=${info.tasks.ready}&section=files`;
browser("open", detailPage);
browser("wait", "iframe[title='Quarterly forecast preview']");
const request = browser(
  "network",
  "requests",
  "--filter",
  detailUrl,
  "--type",
  "fetch",
).requests.at(-1);
const original = JSON.parse(browser("network", "request", request.requestId).responseBody);
const conflicted = structuredClone(original);
conflicted.worktree.units[0].source = "trunk";
conflicted.worktree.units[0].change = "modified";
const previewUrl = `**/universer-api/worktrees/${info.tasks.ready}/units/*/merge-preview`;
try {
  browser("network", "route", detailUrl, "--body", JSON.stringify(conflicted));
  browser(
    "network",
    "route",
    previewUrl,
    "--body",
    JSON.stringify({ evaluation: { status: "conflict" } }),
  );
  browser("open", detailPage);
  browser("wait", "--text", "Merge is currently unavailable.");
  assert(
    evaluate(
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Confirm merge').disabled`,
    ),
  );
  browser("network", "unroute", previewUrl);
  browser(
    "network",
    "route",
    previewUrl,
    "--body",
    JSON.stringify({ evaluation: { status: "preview" } }),
  );
  browser("open", detailPage);
  browser("wait", "--text", "An automatic merge preview is ready for review.");
  assert.equal(
    evaluate(`document.querySelectorAll('[data-testid="merge-preview-control"]').length`),
    1,
  );

  const denied = structuredClone(original);
  for (const key of Object.keys(denied.worktree.capabilities))
    denied.worktree.capabilities[key] = false;
  browser("network", "unroute", detailUrl);
  browser("network", "route", detailUrl, "--body", JSON.stringify(denied));
  browser("open", detailPage);
  browser("wait", "--text", "You do not have permission to review this task");
  assert(
    !evaluate(
      `Array.from(document.querySelectorAll('button')).some(b => ['Confirm merge', 'Discard changes', 'Submit for review', 'Mark for deletion'].includes(b.textContent))`,
    ),
  );

  browser("network", "unroute", detailUrl);
  browser("network", "route", detailUrl, "--abort");
  browser("open", detailPage);
  browser("wait", "--text", "Could not load pull requests");
  browser("network", "unroute", detailUrl);
  click("button", "Retry");
  browser("wait", "iframe[title='Quarterly forecast preview']");
} finally {
  browser("network", "unroute", detailUrl);
  browser("network", "unroute", previewUrl);
}
console.log(
  "PR browser smoke passed: list, detail sections, document/version selection, confirmation cancel, removal/undo, ready/merge/discard, empty state, search, responsive widths.",
);
