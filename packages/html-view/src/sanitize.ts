import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { parseCellReference } from "./reference.js";
import type { HtmlViewDocument, HtmlViewBinding } from "./types.js";

export const MAX_HTML_VIEW_BYTES = 1024 * 1024;
type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
const allowedTags = new Set(
  "html head body title style main section article aside header footer nav div span p h1 h2 h3 h4 h5 h6 strong b em i small label output input select option textarea button ul ol li table thead tbody tfoot tr th td caption colgroup col br hr pre code blockquote details summary figure figcaption svg g path rect circle ellipse line polyline polygon text defs linearGradient radialGradient stop".split(
    " ",
  ),
);
const allowedAttrs = new Set(
  "id class style title lang dir role aria-label aria-labelledby aria-describedby aria-live aria-hidden tabindex for type value min max step required minlength maxlength pattern placeholder disabled readonly checked selected multiple name rows cols width height viewBox d x y x1 x2 y1 y2 cx cy r rx ry points fill stroke stroke-width opacity transform offset stop-color stop-opacity gradientUnits gradientTransform preserveAspectRatio data-univer-cell-text data-univer-cell-model".split(
    " ",
  ),
);

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

// Agent 与 Browser 使用同一解析入口。返回的 HTML 由禁用脚本的宿主容器挂载。
export function parseHtmlView(source: string): HtmlViewDocument {
  if (new TextEncoder().encode(source).length > MAX_HTML_VIEW_BYTES)
    throw new Error("HTML view exceeds 1 MiB.");
  const document = parse(source, { sourceCodeLocationInfo: true });
  const bindings: HtmlViewBinding[] = [];
  const clean = (nodes: Node[], insideText = false): Node[] =>
    nodes.filter((n) => {
      if (!isElement(n)) return n.nodeName === "#text" || n.nodeName === "#documentType";
      if (!allowedTags.has(n.tagName)) return false;
      n.attrs = n.attrs.filter((a) => allowedAttrs.has(a.name) && !a.namespace);
      if (n.tagName === "head") n.attrs = [];
      const attr = (name: string) => n.attrs.find((a) => a.name === name)?.value;
      const text = attr("data-univer-cell-text");
      const model = attr("data-univer-cell-model");
      const fail = (message: string): never => {
        throw new Error(
          `<${n.tagName}> at line ${n.sourceCodeLocation?.startLine ?? "?"}: ${message}`,
        );
      };
      if (text !== undefined || model !== undefined) {
        if (insideText) fail("A text binding cannot contain another binding.");
        if (text !== undefined && model !== undefined)
          fail("Use cell-text or cell-model on an element, not both.");
        if (
          ["html", "head", "body", "title", "style", "svg", "defs", "br", "hr", "col"].includes(
            n.tagName,
          )
        )
          fail("Binding requires a content element.");
        if (text !== undefined && ["input", "select", "textarea"].includes(n.tagName))
          fail("Use cell-model for form controls.");
        if (model !== undefined) {
          if (!["input", "select", "textarea"].includes(n.tagName))
            fail("cell-model requires an input, select, or textarea.");
          if (n.tagName === "select" && attr("multiple") !== undefined)
            fail("cell-model supports single select only.");
          if (
            n.tagName === "input" &&
            !["text", "number", "range", "checkbox"].includes(
              (attr("type") ?? "text").toLowerCase(),
            )
          )
            fail("Unsupported cell-model input type.");
        }
        const name = text !== undefined ? "data-univer-cell-text" : "data-univer-cell-model";
        let reference;
        try {
          reference = parseCellReference(text ?? model!);
        } catch (error) {
          return fail(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const id = String(bindings.length);
        bindings.push({
          id,
          kind: text !== undefined ? "text" : "model",
          reference,
          disabled: attr("disabled") !== undefined,
        });
        n.attrs.push({ name: "data-univer-binding", value: id });
        if (bindings.length > 100) fail("HTML view supports up to 100 binding elements.");
      }
      if (n.tagName === "button")
        n.attrs = [...n.attrs.filter((a) => a.name !== "type"), { name: "type", value: "button" }];
      n.childNodes = clean(n.childNodes, insideText || text !== undefined);
      return true;
    });
  document.childNodes = clean(document.childNodes);
  if (!bindings.length)
    throw new Error(
      "Declare at least one data-univer-cell-text or data-univer-cell-model binding.",
    );
  const csp =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
  const html = serialize(document).replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1">`,
  );
  return { bindings, html };
}
