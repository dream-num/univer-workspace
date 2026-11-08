import {
  UniverProFormulaEnginePlugin,
} from "@univerjs-pro/engine-formula";
import { UniverRemoteBasesPlugin } from "@univerjs-pro/bases/worker";
import { LocaleType, Univer } from "@univerjs/core";
import { UniverRPCWorkerThreadPlugin } from "@univerjs/rpc/worker";

const univer = new Univer({
  locale: LocaleType.EN_US,
});

univer.registerPlugin(UniverProFormulaEnginePlugin);
univer.registerPlugin(UniverRemoteBasesPlugin);
univer.registerPlugin(UniverRPCWorkerThreadPlugin);

(globalThis as typeof globalThis & { univer: Univer }).univer = univer;
