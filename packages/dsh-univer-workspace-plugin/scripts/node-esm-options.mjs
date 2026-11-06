// Bundled CommonJS dependencies still need Node's require inside ESM artifacts.
export const nodeEsmOptions = {
  banner: {
    js: 'import { createRequire as __univerCreateRequire } from "node:module"; const require = __univerCreateRequire(import.meta.url);',
  },
};
