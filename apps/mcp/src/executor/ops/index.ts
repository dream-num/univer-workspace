import type { OpName } from "../../shared/executor-protocol.js";
import type { Handler } from "../context.js";
import { contentExecute } from "./content-execute.js";
import { contentInspect } from "./content-inspect.js";
import { diagnosticsProbe } from "./diagnostics-probe.js";

import { exchangeImport } from "./exchange-import.js";
import { exchangeExport } from "./exchange-export.js";

export const handlers = {
  "exchange.import": exchangeImport,
  "exchange.export": exchangeExport,
  "content.execute": contentExecute,
  "content.inspect": contentInspect,
  "diagnostics.probe": diagnosticsProbe,
} satisfies { [K in OpName]: Handler<K> };
