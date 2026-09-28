# Workspace Markdown Viewer

Private, read-only Markdown presentation shared by Workspace Browser (React 19)
and Workspace Agent (React 18). The host supplies its React runtime, decoded text
and `zh-CN`/`en-US` locale. Both applications bundle this package;
it is not a public SDK or an independently deployed service.

`MarkdownViewer` owns CommonMark/GFM presentation through `react-markdown` and
`remark-gfm`, Preview/Source switching, scoped heading anchors, footnotes, tables,
read-only tasks and theme-aware styles. Raw HTML is displayed as text. Links only
allow HTTP(S), mailto and in-document anchors. Relative paths are not resolved.
External HTTP(S) images require an explicit click and use `no-referrer`. There is
no HTML execution, Markdown editing, Mermaid, math or syntax highlighting.

`./content` exports filename/MIME classification, URL policy and a complete-file
response decoder. Hosts own fetching, credentials, cancellation, Resource
identity, errors and download links. Fetch the complete file without a Range
header. The decoder validates UTF-8 and rejects control bytes and partial responses.
Preview and Source both use the complete text, with no preview size cutoff.
Empty files need no content request. An octet-stream `.md`
or `.markdown` is a candidate only; it must pass the same byte validation. This
covers historical MIME misclassification without changing stored metadata.

Styles use host `--color-*` tokens, with `--uvf-color-*` fallbacks. Host builds
must resolve React from the consuming application; do not bundle this package's
React 18 development runtime into Workspace Browser.

```bash
pnpm --filter @univerjs/univer-workspace-markdown-viewer typecheck
pnpm --filter @univerjs/univer-workspace-markdown-viewer test
pnpm typecheck
```

The tests cover complete reads (including large files), invalid bytes/partial responses, GFM, unsafe URLs/HTML,
external-image opt-in, anchors and Preview/Source switching. Check both consuming
browser builds and their light/dark/narrow layouts when changing presentation.

## Browser fixtures

Run from the repository root in separate terminals:

```bash
pnpm --filter @univerjs/univer-workspace-markdown-viewer exec vite --config vite.preview.config.ts --port 5186
MARKDOWN_HOST=agent pnpm --filter @univerjs/univer-workspace-markdown-viewer exec vite --config vite.preview.config.ts --port 5187
```

Open ports 5186 and 5187 on `127.0.0.1`. These use the real Browser/Agent Markdown
loading adapters with in-memory full-file responses and each host's own React
installation. The selector covers normal, empty, large, binary and forbidden
files; the theme switch covers both palettes. No account or persistent data is
used. These fixtures do not certify the enclosing authenticated application shell.
