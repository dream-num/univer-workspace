# Header fixture

Run `pnpm --filter @univerjs/univer-workspace exec vite --config test/vite.header.config.ts` from the repository root, then open `http://127.0.0.1:5182/test/fixtures/header.html`.

This development entry renders the application Header with inert callbacks and no product data access. Check both languages, long document names, lifecycle states, and frame widths 1440, 1300, 1130, 960, 720, and 480 px. The fixture sidebar stays 256 px wide. Merge preview controls preserve the content-area placement and disappear in comparison mode.

The fixture has its own development configuration and requires no backend. Production
`build:web` still uses `web/index.html`; it does not include this test HTML entry.
`pnpm --filter @univerjs/univer-workspace typecheck` also checks the relocated fixture.

The same dev server serves `http://127.0.0.1:5182/test/fixtures/presence.html` for
the online avatar group. Check hover/focus names, a valid image, missing/broken
image fallback, seven connections deduplicated into six users, overflow, language,
theme, narrow widths, and clearing the group with Toggle connection. Toggle
overflow switches between four users (no count circle) and six users (`+2`). It uses
fixture data only and does not connect to a collaboration server.
