# OfficeLab Repository global screens

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product

Univer Workspace is an open-source, deployable Office workspace where people and AI
agents create, collaborate, and review together. Its React Browser, Workspace Agent,
and CLI connect to the Workspace Server, which owns product storage and permissions.
Agents edit isolated Worktrees; people review changes before merging them.

Repository mode uses the **OfficeLab** brand. Wiki remains a separate mode. This
document covers Repository's dashboard, repository directory, global Pull Requests
and Issues, Recent, and Pages.

## Confirmed workflows

- Find accessible repositories, search the directory, and create a Team Space through
  the existing creation dialog. Repository navigation uses the existing Space model.
- Continue recently opened files from the dashboard or Recent list.
- Open Worktree review through Pull Requests and browse Issues across repositories.
- Discover HTML Pages using real file, repository, and timestamp metadata. Open a
  selected Page through the existing preview or immersive viewer.
- Reach Workspace Agent downloads and CLI guidance from the dashboard.

## Selected constraints

- The user selected **A「GitHub 工作总览」** and approved high GitHub fidelity.
  The [direction contract](docs/proposals/repository-dashboard.md) records that decision.
- Global screens support light and dark themes and mobile navigation. Existing shared
  UI primitives, resource access rules, permissions, and review workflows remain the
  application contracts.
- Display actual query results and explicit loading, error, and empty states. Loaded
  item counts describe loaded items; they are not invented totals or activity metrics.
- Page cards use metadata and SVG icons, not fabricated thumbnails or embedded live
  previews. Opening a Page reuses the existing safe preview boundary.
- This design controls Repository global chrome, not Office editor or HTML iframe
  appearance. It introduces no shipping raster assets.

Sources: [repository README](../../README.md), [application README](README.md),
[direction contract](docs/proposals/repository-dashboard.md), and
[implemented dashboard](web/src/modes/repository/pages/home.tsx).
