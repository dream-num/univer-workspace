import { createClientPlugin } from "./plugin.js";

declare global {
  interface Window {
    readonly __ModuleLoader__?: {
      load(entry: {
        readonly id: string;
        readonly factory: (require: (id: string) => unknown) => unknown;
      }): void;
    };
  }
}

const loader = globalThis.window?.__ModuleLoader__;
if (loader) {
  loader.load({
    id: "@univerjs/univer-workspace-harness",
    factory: () => createClientPlugin(),
  });
}
