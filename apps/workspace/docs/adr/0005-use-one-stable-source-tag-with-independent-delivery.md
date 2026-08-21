---
status: superseded by ADR-0006
---

# Use one stable source tag with independent delivery

A stable `vX.Y.Z` repository tag is the immutable source coordinate shared by
`univer-workspace-cli@X.Y.Z` and a Workspace container deployment. Pushing the tag
publishes only the CLI to insider-npm; the deployment workflow separately and manually
selects an existing tag, builds that exact commit, and uses the same value as its image
tag. Insiders and dev CLI releases have no repository tag, the SDK baseline remains an
independent exact version, and the product database continues to use its independent
`PRAGMA user_version`. This supersedes the Git-SHA image identity in ADR-0003 without
combining CLI publication and server deployment into one workflow.
