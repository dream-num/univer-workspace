import type { HtmlViewDocument } from "@univerjs/workspace-html-view";
import { mountCellBindings, type CellBindingEngine } from "./dom.js";
export { mountCellBindings, type CellBindingTarget, type CellBindingEngine } from "./dom.js";

export function mountHtmlView(options: {
  document: Document;
  template: HtmlViewDocument;
  engines: ReadonlyMap<string, CellBindingEngine>;
  onError?: (message: string) => void;
}) {
  const targets = options.template.bindings.map((declaration) => {
    const element = options.document.querySelector<HTMLElement>(
      `[data-univer-binding="${declaration.id}"]`,
    );
    if (!element) throw new Error(`Binding element is missing: ${declaration.id}`);
    const engine = options.engines.get(declaration.reference.unitId);
    if (!engine) throw new Error(`Binding Engine is missing: ${declaration.reference.unitId}`);
    return {
      element,
      engine,
      reference: declaration.reference,
      kind: declaration.kind,
      disabled: declaration.disabled,
    };
  });
  // 可复用同一 Document；初始 disabled 意图来自模板，不继承上次卸载后的状态。
  for (const target of targets)
    if (target.kind === "model") target.element.toggleAttribute("disabled", target.disabled);
  return mountCellBindings(targets, options.onError);
}
