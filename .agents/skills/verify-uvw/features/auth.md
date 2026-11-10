# Accounts and sign-in

A visitor creates a password account from the sign-in page and lands on Home with a new
Personal Space. An existing user signs in with username and password. The uvw CLI signs
in non-interactively with a username and a password piped on stdin.

## Sub-features

- `auth-register-web` creates an account from the `Create account` mode of `/login`.
- `auth-signin-web` signs an existing user in from `/login`.
- `auth-cli-password` signs uvw in with `--username` and `--password-stdin`. It uses
  `/api/auth/cli/password/login` to create an Agent session, with one retry on
  `/api/auth/password/login` only after HTTP 404 from an older server.
- `auth-cli-status` shows the signed-in origin and user.
- `auth-profile-user-id` shows the Workspace user ID in the Profile dialog, with a `Copy user ID` button. This is
  the ID that `$V mcp-allow-users` takes.

## How to get to it (user POV)

- Open `http://127.0.0.1:5973/login` (any signed-out route redirects there). Choose
  `Create account` or stay on `Password`.
- Run `uvw auth login --username <name> --password-stdin`, then `uvw auth status`.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run is up and `$V doctor` is clean. Browser signed out (`agent-browser cookies clear`).
- Pin the Wiki page theme before opening any route: `agent-browser storage local set univer-workspace-layout-theme wiki`. A fresh session starts in Repository.

- **Open sign-up.** Run `agent-browser open "$ORIGIN/login"`, `agent-browser wait 1500`,
  then `agent-browser find role button click --name "Create account"`. A `Display name`
  textbox appears between `Username` and `Password`.
- **Fill and submit.** Run `agent-browser find label "Username" fill "web-$VERIFY_UVW_RUN"`,
  `agent-browser find label "Display name" fill "Web Verify"`,
  `agent-browser find label "Password" fill "verify-pass-123"`, and
  `agent-browser click 'form button[type=submit]'`. The URL becomes `$ORIGIN/home`, the
  heading is `Home`, and the sidebar shows `Personal Space` with `No files`.
- **Proof (register).** Run `agent-browser screenshot "$EVIDENCE/auth-register-home.png"`,
  then `agent-browser reload` and `agent-browser get url`. It is still `$ORIGIN/home`, so the
  session cookie persisted.
- **Sign in as the baseline user.** Run `agent-browser cookies clear`, open `/login`, wait,
  run `find label "Username" fill "verify-$VERIFY_UVW_RUN"` and
  `find label "Password" fill "$(cat /tmp/verify-uvw/$VERIFY_UVW_RUN/user.pw)"`, submit, and
  run `agent-browser wait --url '**/home'`. The `Account` button shows initial `V`.
- **CLI login.** `$V user` already did this. To drive it explicitly, run
  `$V cli auth-login auth login --username "verify-$VERIFY_UVW_RUN" --password-stdin --json < /tmp/verify-uvw/$VERIFY_UVW_RUN/user.pw`.
  Exit `0`, and stdout has `origin: http://127.0.0.1:5973` and `subject.name: Verify <run-id>`.
- **CLI status.** Run `$V cli auth-status auth status --json`. It shows the same origin and
  subject.
- **Wrong password.** Run `printf wrong-password | $V cli auth-bad auth login --username "verify-$VERIFY_UVW_RUN" --password-stdin`.
  It exits non-zero and `auth status` still reports the previous session.
- **Profile user ID.** Run `agent-browser find role button click --name "Account"`, then
  `agent-browser find role menuitem click --name "Profile"`. The dialog `Profile and sign-in methods` shows
  `User ID: <id>`, equal to `subject.id` from `$V uvw auth status --json`. Run
  `agent-browser find role button click --name "Copy user ID"`: a `User ID copied.` toast shows. Screenshot
  `$EVIDENCE/auth-profile-user-id.png`.

## Gotchas

- In sign-up mode `Create account` names both the mode tab and submit. `find role button … --exact` picks
  the mode tab, not submit, so the form silently stays on `/login`. The other tab is `Password`; only
  submit is named `Sign in`. An `Email` tab appears only when the server has an email sender, which a
  verify run never has.
- `auth status` reports the display name (`Verify <run-id>`), not the username.
- Registration from curl without `Accept-Language` still names the space
  `<display name> 的个人空间`; the name is fixed server-side, not a locale bug in the run.
- Browser-approved `uvw auth login` (no `--username`) prints a verification URL and code and exits; after the
  approval in the Browser, `uvw auth login --complete` finishes it. MA8 in [the MCP journeys](mcp.md) drives that
  approval with agent-browser.
