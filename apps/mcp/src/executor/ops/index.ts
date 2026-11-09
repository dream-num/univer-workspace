import type { OpName } from "../../shared/executor-protocol.js";
import type { Handler } from "../context.js";
import { contentExecute } from "./content-execute.js";
import { contentInspect } from "./content-inspect.js";
import { diagnosticsProbe } from "./diagnostics-probe.js";

import { exchangeImport } from "./exchange-import.js";
import { exchangeExport } from "./exchange-export.js";

import { htmlViewCreate, htmlViewValidate } from "./html-view.js";
import { typstCompile } from "./typst-compile.js";
import { svgCompile } from "./svg-compile.js";
import { markdownCompile } from "./markdown-compile.js";
import { markdownExport } from "./markdown-export.js";
import { renderLint } from "./render-lint.js";
import { renderPrintPdf } from "./render-print-pdf.js";
import { renderScreenshot } from "./render-screenshot.js";

export const handlers = {
  "htmlView.validate": htmlViewValidate,
  "htmlView.create": htmlViewCreate,
  "markdown.compile": markdownCompile,
  "markdown.export": markdownExport,
  "typst.compile": typstCompile,
  "svg.compile": svgCompile,
  "exchange.import": exchangeImport,
  "exchange.export": exchangeExport,
  "content.execute": contentExecute,
  "content.inspect": contentInspect,
  "render.screenshot": renderScreenshot,
  "render.printPdf": renderPrintPdf,
  "render.lint": renderLint,
  "diagnostics.probe": diagnosticsProbe,
} satisfies { [K in OpName]: Handler<K> };
