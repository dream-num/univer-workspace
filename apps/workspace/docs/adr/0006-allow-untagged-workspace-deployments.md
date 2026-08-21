---
status: accepted
---

# Allow untagged Workspace deployments

The manual Workspace deployment workflow accepts an optional stable `vX.Y.Z` release
tag. When a tag is provided, the workflow retains the shared release coordinate from
ADR-0005 and uses that tag for the container image. When it is omitted, the workflow
builds the exact commit selected by the workflow dispatch and uses `sha-<commit>` as
the immutable image tag. CLI publication remains tag-driven and independent from
Workspace deployment. This supersedes ADR-0005 while preserving its tagged release
behavior as one of the two supported deployment source modes.
