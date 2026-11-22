# Preview a local HTML View before saving

Use this reference only when running a local preview. Write the bound page to a local
HTML file first. If a local file with bindings already exists, use that file.

## Start the preview

1. Check that Node 18.2 or newer is available with `node --version`.
2. With MCP, call `skills_read {"name":"html-view","resource":"scripts/preview.mjs"}`.
   Write the complete returned content to a local file named preview.mjs.
   With the CLI, use scripts/preview.mjs inside the installed html-view Skill directory.
   The `core` Skill explains how to locate that directory.
3. Run the script beside the page, or use absolute paths:

   ```text
   node preview.mjs page.univer.html [--open]
   ```

   Replace the page filename with your file. Add `--open` to open the system browser.
   For another Workspace deployment, add `--workspace <origin>`.
   The default origin is https://space.univer.ai. Keep the process running while you edit.
4. Read the `ready` line and give its `url` to the user. The user opens the URL in a
   signed-in browser, loads the page, reviews the listed sources, and confirms trust.
   The script only serves local HTML. The browser uses its Workspace login to read live data.
5. For pull-request data, add `repo` and `pr` to the URL before opening it.
   For example, append `&repo=owner%2Frepo&pr=12` to the printed URL.
   Keep `src`, `token`, and `file` intact. Use the same repository and PR when saving.

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

Then call `html_view_save` once to create a draft. Revise a pending draft with `draft`
instead of creating another page. Return the draft preview URL to the user.
Follow the creator Skill for publication and access wording.

## Handle browser limits

Chrome can ask for local network access when Workspace loads the file from this machine.
Have the user allow the prompt, then retry loading. If access was denied, change the site's
local network permission and retry, or use the file picker.

Safari supports the file picker only. Open /html-view-preview on the Workspace origin,
choose the local page, and confirm trust. After each file save, pick the file again.
File-picker diagnostics remain in the browser panel rather than returning to the script.
Have the user share those diagnostics before claiming the preview passed.

If Node or a local shell is unavailable, skip local preview. Call `html_view_save` with
`dryRun: true` and the intended save arguments. This validates bindings without creating
a draft. Fix the returned binding samples and repeat the dry run before saving once.
Dry runs do not execute scripts or prove rendering. Say that render checks did not run.
CLI-only users use `html-view validate` before creation or replacement.
