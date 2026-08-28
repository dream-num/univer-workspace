import {
  createPresetRenderUniver,
  mountUniverRenderPage,
} from "@univer-cli/univer-render-page";

const container = document.querySelector<HTMLElement>("#app");
if (container === null) {
  throw new Error("Render Page requires an #app container");
}

await mountUniverRenderPage({
  container,
  createUniver: async (context) => {
    if (context.license === undefined) {
      throw new Error("Render Page requires a Univer license bootstrap");
    }
    return await createPresetRenderUniver(context);
  },
});
