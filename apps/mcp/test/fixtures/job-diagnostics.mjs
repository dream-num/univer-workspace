process.once("message", () => {
  const root = process.cwd();
  process.send({
    ok: true,
    value: {
      committed: false,
      javascript: 'return "/user-authored/path";',
      title: "Diagnostics",
      targetUnitId: "diagnostics",
      diagnostics: [{
        sourcePath: `${root}/workspace-typst-test/nested/page.typ`,
        reason: `file not found (searched at ${root}/dac-typst-eval-test/dac/assets/missing.png)`,
      }],
      previews: [{ pageId: "1", path: `file://${root}/workspace-typst-test/preview.svg`, sourcePath: "nested/page.typ" }],
    },
  }, () => process.disconnect());
});
