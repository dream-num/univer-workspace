process.once("message", (message) => {
  process.send(
    {
      ok: false,
      error: {
        code: message.options.fileName,
        message: "failed at /private/secret/input.xlsx",
        detail: {
          diagnostics: [{
            sourcePath: `${process.cwd()}/workspace-typst-test/nested/page.typ`,
            reason: `file not found (searched at ${process.cwd()}/dac-typst-eval-test/dac/nested/missing.png)`,
            suggestedRewrite: "check /private/secret/other.txt",
          }],
        },
      },
    },
    () => process.disconnect(),
  );
});
