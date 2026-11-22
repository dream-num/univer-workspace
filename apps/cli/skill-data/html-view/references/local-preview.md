# Preview a local HTML View live in the browser

Use this reference when the user accepts a live local preview: after a draft is saved
through MCP, or before `html-view create` with the CLI. Write the page to a local HTML file,
or use the existing local file.

## Start the preview

1. Check that Node 18.2 or newer is available with `node --version`.
2. With MCP, call `skills_read {"name":"html-view","resource":"scripts/preview.mjs"}`.
   Write the complete returned content to a local file named preview.mjs.
   With the CLI, use scripts/preview.mjs inside the installed html-view Skill directory.
   The `core` Skill explains how to locate that directory.
3. Run the script beside the page, or use absolute paths:

   ```text
   node preview.mjs page.univer.html --open [--repo <owner/slug> --pr <n>]
   ```

   Replace the page filename with your file. `--open` opens the user's browser.
   For pull-request data, pass the same `--repo` as the save and the pull request number as `--pr`
   (not a Worktree id).
   For another Workspace deployment, add `--workspace <origin>`.
   The default origin is https://space.univer.ai. Keep the process running while you edit.
4. Tell the user the preview opened in their browser: click Load page, allow local network
   access if Chrome asks, review the listed sources, and confirm trust. Also give the `url`
   from the `ready` line in case the browser did not open.
   The script only serves local HTML. The browser uses its Workspace login to read live data.

Preview writes are trial by default. Controls recalculate in the browser without saving
source changes. Keep trial mode during debugging. A PR preview only allows trial writes.
Outside a PR, writing real data requires the user's explicit switch and confirmation.

## Read the report and fix the page

Stdout contains one JSON object per line:

- `{"event":"ready","url":"...","file":"...","token":"..."}` gives the preview URL.
- `{"event":"report",...}` contains diagnostics for the rendered HTML.
- `{"event":"waiting","seconds":30}` means the browser has not loaded the local page yet.
  Check the browser handoff and local network permission. This is not a passing report.

To fetch the latest report instead, take the local origin from the URL's `src` parameter
and request `GET /report?token=<token>` there. Use the token from `ready`.
The endpoint returns HTTP 204 before any report, then HTTP 200 with the latest report.

For each report, check the following before saving:

- Fix every `renderCheck` issue. Require status `passed`, not `issues`, `timed-out`, or `failed`.
- Fix every warning in `bindings`. Check empty values, header text where numbers belong,
  formula cells behind writable controls, and date serial numbers against the inspected Sheet.
- Remove every entry in `leftoverPlaceholders`. Wait for real data before judging empty widgets.

Save the local file after each fix. The connected preview reloads and sends a new report.
Read the newest report, and repeat until it passes with no binding warnings or leftover
placeholders. Check the page at 360px, 390px, and 1440px with the viewport controls.
The report's `sha256` identifies the checked HTML. Save that same content.

Then save that content once. Through MCP, revise the pending draft with `html_view_save` and
`draft` instead of creating another page, and return the draft preview URL. Follow the creator Skill for publication and access wording. With the CLI, which has no
drafts, run `html-view validate` and then `html-view create`, which publishes at once, or
replace an existing page's Blob, as the html-view Skill describes.

## Handle browser limits

Chrome can ask for local network access when Workspace loads the file from this machine.
Have the user allow the prompt, then retry loading. If access was denied, change the site's
local network permission and retry, or use the file picker.

Safari supports the file picker only. Open /html-view-preview on the Workspace origin,
choose the local page, and confirm trust. After each file save, pick the file again.
File-picker diagnostics remain in the browser panel rather than returning to the script.
Have the user share those diagnostics before claiming the preview passed.

The preview reads Sheets as the person signed in to the browser. When this connection is an
agent identity, its Sheets are private to it, so that person cannot read them: skip local preview.
If Node or a local shell is unavailable, skip local preview too. Call `html_view_save` with
`dryRun: true` and the intended save arguments. This validates bindings without creating
a draft. Fix the returned binding samples and repeat the dry run before saving once.
Dry runs do not execute scripts or prove rendering. Say that render checks did not run.
CLI-only users use `html-view validate` before creation or replacement.
