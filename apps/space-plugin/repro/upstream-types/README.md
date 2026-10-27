# Published SDK declaration reproduction

Copy this directory to an empty directory, run `npm install --ignore-scripts`, then `npm run typecheck`. No application code, `skipLibCheck`, source imports or declaration overlay is involved. For the exact release dependency graph, run the repository plugin's `npm ci`, then from the plugin root run `node node_modules/typescript/bin/tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 repro/upstream-types/repro.ts --pretty false`.

Upstream fixes should restore the declared public exports (Core SheetViewModel/Charset, Boards rich-text helpers, collaboration event, chart config/host adapters, Sheets command exports and Sheets UI type); emit engine-shape paths relative to the published declaration location; declare valid ambient constants in Boards; import Network IHTTPRequestParams; and omit the native textarea onResize when defining its custom callback. Verify each fix against packed npm tarballs in both React 18 and React 19 consumer graphs. A consumer declaration shim cannot repair these contracts safely.

The previous DSH sessions ambient conflict came from combining Host/client programs and importing Node Tools through browser wire types. The release uses separate complete strict programs and neutral wire types, not an override of either SDK service.
