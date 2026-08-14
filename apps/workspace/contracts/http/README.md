# Univer Workspace OpenAPI

This directory contains the HTTP contract for Univer Workspace.

## Source of truth

- `openapi.yaml` is the OpenAPI 3.1.2 entry document.
- `paths/` contains HTTP Path Items grouped by product area.
- `schemas/` contains reusable request and response schemas.
- `concepts.md` contains behavior shared by multiple operations.
- `generated/http/openapi.bundled.yaml` is the generated single-file contract.
- `generated/http/schema.d.ts` contains generated TypeScript types.

Generated files must not be edited directly.

```bash
pnpm api:lint
pnpm api:generate
pnpm api:verify
```
