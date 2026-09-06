# Header fixture

Run `pnpm --filter @univerjs/univer-workspace exec vite --config test/vite.header.config.ts` from the repository root, then open `http://127.0.0.1:5182/test/fixtures/header.html`.

This development entry renders the application Header with inert callbacks and no product data access. Check both languages, long document names, lifecycle states, and frame widths 1440, 1300, 1130, 960, 720, and 480 px. The fixture sidebar stays 256 px wide. Merge preview controls preserve the content-area placement and disappear in comparison mode.

The fixture has its own development configuration and requires no backend. Production
`build:web` still uses `web/index.html`; it does not include this test HTML entry.
`pnpm --filter @univerjs/univer-workspace typecheck` also checks the relocated fixture.
