import type { OpName } from "../../shared/executor-protocol.js";
import type { Handler } from "../context.js";
import { contentExecute } from "./content-execute.js";
import { contentInspect } from "./content-inspect.js";
import { diagnosticsProbe } from "./diagnostics-probe.js";

import { exchangeImport } from "./exchange-import.js";
import { exchangeExport } from "./exchange-export.js";

import { htmlViewCreate, htmlViewValidate } from "./html-view.js";
import { markdownCompile } from "./markdown-compile.js";
import { markdownExport } from "./markdown-export.js";

export const handlers = {
  "htmlView.validate": htmlViewValidate,
  "htmlView.create": htmlViewCreate,
  "markdown.compile": markdownCompile,
  "markdown.export": markdownExport,
  "exchange.import": exchangeImport,
  "exchange.export": exchangeExport,
  "content.execute": contentExecute,
  "content.inspect": contentInspect,
  "diagnostics.probe": diagnosticsProbe,
} satisfies { [K in OpName]: Handler<K> };
