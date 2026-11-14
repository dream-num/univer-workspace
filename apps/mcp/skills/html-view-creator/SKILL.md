---
name: html-view-creator
description: Build or change a live page (.univer.html HTML View) on Workspace Sheet data together with the user. Reads the Sheet, proposes a data plan and a style in one turn, writes the page from a template, and saves a draft the user previews and publishes in Workspace. Use whenever the user wants a dashboard, form, report, tracker or any page on top of Sheet data, or wants to change or restyle an existing page, even if they never say "HTML View".
user-invocable: true
---

# HTML View Creator

You help the user build a page on live Sheet data, or change one. A page is a
.univer.html file. Its HTML bindings read and write its source Sheets on trunk, so
the page always shows current values. You never publish a page. You save a draft with
`html_view_create` or `html_view_replace`, and the user previews and publishes it in
Workspace.

This Skill decides the order of the work. The `html-view` Skill decides how a page is
written: bindings, the style catalog, templates and the design floor. Read it with
`skills_read {"name": "html-view"}` before step 3, and read its references when a step
names them.

When the user invokes `/html-view-creator`, their request follows at the end as
`ARGUMENTS:`. Workspace adds a resource ID when the user starts from a Sheet or a page.
Figure out where they are in the flow below and start there.

## Rules for the whole flow

- **Live data only.** The page shows source values through bindings. Never copy Sheet
  data into the page, add fallback numbers, or redo a Sheet formula in page code. Page
  controls write source cells, and the page shows the recalculated values.
- **Draft only.** Only the user can publish. Until `html_view_draft_get` returns
  `state: "published"`, never say the page is live and never share its `shareUrl`.
- **A page is not a Unit.** If `html_view_create` is not in your tool list, say this
  connection cannot draft pages and stop. Never make a Slide, Board or other Unit instead.
- **Ask mode cannot save.** Drafting needs write access and Ask mode has only read
  access. In Ask mode, finish steps 1 to 4 and show the plan and what the page will
  contain. Tell the user to switch to Auto and send any message such as "save it". Then
  do step 5 without repeating earlier steps.
- **Short turns.** Ask at most three questions per turn, in the user's language. Many
  users are not developers. Say page, Sheet and cell. Avoid binding, Blob, ETag and
  unitId unless the user uses them.

## 1. Classify the task

- **New page.** Go to step 2.
- **Change a page.** Read it with `html_view_read`. Keep its style and data unless the
  user asks otherwise. Go to step 2 when the change needs data the page does not use yet,
  otherwise to step 4.
- **Restyle a page.** Read it with `html_view_read`, then go to step 3 and propose
  styles only.

## 2. Read the data

Find the Sheet with `space_find` unless the request gives its resource ID. Read it with
`outline`, then `read` or `find` for the parts the page will use. For each part, note:

- the unitId and worksheet ID. Resource IDs and worksheet names are different identities.
- the header row, the data range, and how far the range must reach as records are added.
- formula cells, which the page displays but never writes.
- input cells the user may want to edit from the page.

Read before you ask, so your questions can name real columns. If the purpose is unclear,
ask what the page is for: a dashboard, a form that adds records, a report or a tracker.

Find out who will open the page: only the user, their team, or anyone with the link.
Anyone with the link needs the page and its source Sheets in a public repository. Check
the repository with `repo_view` now, not at the end.

## 3. Propose the plan and the style in one turn

Send one message with:

1. The page in one sentence, in the user's words.
2. The data plan, as a short table with one row per part of the page: what it shows or
   edits, the worksheet and range, and whether the page reads or writes it. Say which
   cells the page will change in the source Sheet. A change there is a change for
   everyone who uses that Sheet.
3. The style question, as the design reference of the `html-view` Skill describes it.
   If the user already named a style, confirm it instead.
4. Who can open the page, and anything that stops it, such as a private repository
   when they want a public link.

Then end your turn and wait. Do not write, validate or draft the page before the user
answers. If they leave the choices to you, use the default style and the plan as proposed.

## 4. Write and check

Read the chosen template and the authoring reference from the `html-view` Skill. Start
from the template's full source and adapt it to the plan. Write every visible string in
the user's language.

Call `html_view_validate` with the complete HTML. Compare the result with the plan:
every planned Sheet appears, and no binding falls outside its worksheet. Fix the page
and validate again until it passes. Validation does not run scripts or show you the
page. Say so when you report, and name the checks that ran.

## 5. Save the draft

- New page: call `html_view_create` with the HTML, the destination `space` (the source
  Sheet's repository unless the user named another), a short `name` in the user's
  language, and a new random idempotency_key such as a UUID.
- Change: call `html_view_replace` with the page resource, the HTML, the ETag from
  `html_view_read` and a new random idempotency_key.

Reply with what the page does, its source Sheets, who will be able to open it (from
`repositoryVisibility` and `privateSourceUnitIds`), and draft.previewUrl. Say the page
is not live until they open the preview and press **Publish**. Then end your turn.

## 6. Iterate and publish

When the user comes back, call `html_view_draft_get` with the draft ID before you say
anything about the draft.

- `pending`: they have not decided. If they ask for changes, apply them to your last
  HTML and save a new draft as in step 5 with a new key. Point them to the newest draft.
- `published`: share `shareUrl` and say who can open it. Later changes start again from
  step 1 as a change.
- `rejected`: ask what to change, then return to step 3 or 4.
- `conflicted`: someone changed the page after you read it. Read it again with
  `html_view_read`, reapply the change and save a new draft.
- `expired`: a draft lasts one hour. Save it again with a new key.
