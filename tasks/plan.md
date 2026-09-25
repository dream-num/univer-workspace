# Implementation Plan: Team Space Repository View

## Overview

Present each Team Space through a GitHub/GitLab-style repository view while retaining the current wiki-style route. Reuse existing Space, Node, Resource, Apps, and Worktree modules. Do not add a repository table. Repository mode is an experimental browser-local theme; Wiki remains the default.

## Dependency graph

```text
Existing Space/Node/HTML View/Worktree contracts
  -> repository-mode routing and C sidebar
  -> selected .univer.html landing state
  -> repository overview composition
  -> focused browser and contract verification
```

## Vertical slices

1. **Repository mode shell**: switch a Team Space between wiki and repository mode; render the accepted C sidebar and route existing data, Apps, Worktrees, Members, and Settings.
2. **Repository landing App**: list Team Space `.univer.html` Apps, choose one, persist and validate the selection, and render it in the overview.
3. **Verification and documentation**: contract generation, migration matrix if schema changes, responsive/browser checks, and update design docs.

## Risks and mitigations

- **Duplicate model risk**: keep Team Space as repository identity and reuse existing modules.
- **Invalid landing App**: validate same-Space ownership, suffix, readiness, and access on the server; fall back by stable ordering.
- **Routing churn**: prefer URL search state on the existing Space route unless TanStack Router constraints require a route segment.
- **Schema scope**: decide between one nullable Space field and a tiny preference table before migration work; do not add both.

## Checkpoints

- After Task 1: C sidebar and mode switching render against existing data with no API changes.
- After Task 2: landing App selection works with multiple, zero, deleted, and inaccessible Apps.
- Before delivery: run API verification, typecheck, focused tests, and responsive browser checks.
