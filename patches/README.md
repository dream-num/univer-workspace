# Dependency patches

`@electron__osx-sign@1.3.3.patch` applies only to desktop packaging. DSH Desktop's
[patch](https://github.com/deepseek-ai/deepseek-harness/blob/master/patches/%40electron__osx-sign%401.3.3.patch)
uses `lstat` so Framework symlinks are not traversed repeatedly. We use the same
fix and additionally serialize recursive file probing: our external Node/DSH
runtime exhausted file descriptors even with a 65536 limit in native macOS CI.
Both CommonJS and ESM entry points receive the fix. Errors still fail signing.

Remove this patch after upgrading to an upstream signer that skips aliases and
bounds file probing, verified by the low-descriptor regression test and actual
macOS signing/notarization. The patch does not skip native binaries or disable
signature verification.
