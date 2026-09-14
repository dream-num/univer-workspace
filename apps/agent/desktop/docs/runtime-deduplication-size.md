# Remaining Desktop runtime size

The published alpha.5 size reports come from [official run 34839282819](https://github.com/dream-num/univer-workspace/actions/runs/34839282819).
Values below use decimal MB and describe possible removal of the complete
component, not an implemented or compatibility-tested optimization.

| Component | Windows installed | macOS arm64 installed | Linux installed |
| --- | ---: | ---: | ---: |
| Standalone Node | 92.793 MB | 121.728 MB | 124.419 MB |
| Separate browser directory | 416.281 MB | 347.834 MB | 384.945 MB |
| Combined | 509.074 MB | 469.562 MB | 509.364 MB |

The complete local Windows alpha.5 validation installer was built from the same
production ASAR integration, with an isolated application ID. Reading its embedded
`$PLUGINSDIR/app-64.zip` central directory gives the actual Deflate payload sizes:

| ZIP prefix | Files/entries | Installed bytes | Compressed bytes |
| --- | ---: | ---: | ---: |
| `resources/runtime/node/` | 6 | 92,793,337 | 33,102,895 |
| `resources/runtime/browsers/` | 330 | 416,280,749 | 177,009,542 |
| Combined | 336 | 509,074,086 | 210,112,437 |

Removing both components could therefore reduce the roughly 506 MB Windows
installer to roughly 296 MB before replacement code and packaging overhead.
These are measured ZIP entry sizes, not a measured rebuilt installer. macOS DMG
and Linux AppImage use different compression formats; their download savings have
not been measured by this ZIP comparison.

Standalone Node still serves terminal/external commands; Electron's Node mode
alone does not establish equivalent console behavior, tool execution or native
addon compatibility. The separate Chromium serves the headless document renderer.
Reusing Electron requires a supported renderer lifecycle and screenshot/export
validation. Neither directory can be removed solely because the DSH service now
runs through Electron. The browser-directory total is an upper bound if some
helper assets still need to remain.
