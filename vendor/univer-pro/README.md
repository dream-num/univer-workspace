# Readable @univerjs-pro copies

Published Univer Pro packages ship javascript-obfuscator string-array wrappers.
This directory holds decoded copies so we can read and patch them.

Regenerate (does not mutate the pnpm store; it unlinks then writes into `node_modules`):

```bash
node scripts/deobfuscate-univer-pro.mjs              # history + collab set
node scripts/deobfuscate-univer-pro.mjs --all        # every @univerjs-pro package
node scripts/deobfuscate-univer-pro.mjs --fix-vendor # repair glued keywords + prettier
```

Edit files here, then re-apply:

```bash
node scripts/deobfuscate-univer-pro.mjs --fix-vendor
```

`pnpm install` restores obfuscated packages. Run the script again after install.
