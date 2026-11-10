# Issues

A Team Space repository tracks Issues numbered `#N`. An agent opens an Issue with uvw. A
person comments on it and closes it in the browser, and the agent reads the comment and the
close event back from the timeline.

## Sub-features

- `issue-repo-create` creates a Team Space repository with `uvw repo create`.
- `issue-create-cli` opens an Issue with `uvw issue create`.
- `issue-comment-web` posts a comment from the Issue page.
- `issue-close-web` closes the Issue from the Issue page.
- `issue-timeline-cli` reads state, comments and events with `uvw issue view -c`.

## How to get to it (user POV)

- `uvw repo create <slug>`, `uvw issue create -R <owner>/<slug> -t … -b …`,
  `uvw issue view <n> -R <repo> -c`.
- `uvw browse <n> -R <repo>` prints `$ORIGIN/spaces/<spaceId>/issues/<n>`. The sidebar
  `Issues` section lists Team Spaces with open Issues.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run with `$V user`. Browser signed in as the baseline user. `O=verify-$VERIFY_UVW_RUN`.
- Pin the Wiki page theme before opening any route: `agent-browser storage local set univer-workspace-layout-theme wiki`. A fresh session starts in Repository.
- No repository `verify-team` exists.

- **Create repo.** Run `$V cli issue-repo-create repo create verify-team --name "Verify Team" --json id,fullName`.
  The output has `fullName: "<O>/verify-team"`.
- **Open Issue.** Run `$V cli issue-create-cli issue create -R $O/verify-team -t "Totals look wrong" -b "North should be 42" --json number,state,title`.
  Output: `number: 1`, `state: "open"`.
- **Open it in the browser.** Run `agent-browser open "$($V uvw browse 1 -R $O/verify-team)"`
  and `agent-browser wait 3000`. The heading reads `Totals look wrong #1`, and the body
  says `North should be 42`.
- **Comment.** Run `agent-browser find label "Add a comment" click`,
  `agent-browser keyboard type "Confirmed in browser"`, and
  `agent-browser find role button click --name "Comment" --exact`.
- **Close.** Run `agent-browser find role button click --name "Close issue"`,
  `agent-browser wait 2000`, and `agent-browser screenshot "$EVIDENCE/issue-close-web.png"`.
  The timeline shows `closed this as completed`, and the button now reads `Reopen issue`.
- **CLI readback.** Run `$V cli issue-timeline-cli issue view 1 -R $O/verify-team -c --json`.
  The output has state `closed`, a comment with body `Confirmed in browser`, and an event
  with `type: "event"`, `kind: "closed"` and `payload.reason: "completed"`.

## Gotchas

- `agent-browser find label "Add a comment" fill …` sets the value without React noticing.
  `Comment` stays disabled, and a later `Close issue` closes without the comment. Click and
  `keyboard type` instead, and confirm `Comment` is enabled in `snapshot -i` first.
- While the comment box holds text, the close button reads `Close with comment`. It reads `Close issue`
  only after `Comment` has posted and cleared the box.
- Issues need a Team Space. `uvw issue create -R <owner>/personal` fails with
  `CONFLICT: Issues are available only in team spaces.`
- The page's accessibility snapshot does not include comment bodies (`snapshot -c` will not
  find them). Prove the comment with the screenshot and the uvw timeline.
