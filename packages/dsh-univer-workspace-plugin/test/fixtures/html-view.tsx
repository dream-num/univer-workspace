/** Real SDK sandbox + Agent retention, with an in-memory engine instead of server data. */
import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { CollaborationStatus } from "@univerjs-pro/collaboration-client";
import type { HtmlViewHostOptions } from "@univerjs/univer-workspace-html-viewer";
import { mountRetainedHtmlView } from "../../src/client/html-views/retained-preview.tsx";

let value: string | number | boolean = "Initial value";
let offline = false;
let disposed = 0;
const listeners = new Set<(state: { value: typeof value }) => void>();
const source = `<!doctype html><html><head></head><body>
<h1>Live HTML View</h1>
<span data-univer-cell-text="unit:sheet:A1"></span>
<input aria-label="Cell value" data-univer-cell-model="unit:sheet:A1">
<script>window.fixtureCounter = (window.fixtureCounter || 0) + 1;</script>
</body></html>`;

const loadEngine: HtmlViewHostOptions["loadEngine"] = async () => ({
  getMetadata: () => ({
    unitId: "unit",
    name: "Budget workbook",
    sheets: [{ sheetId: "sheet", name: "Summary" }],
  }),
  getCellState: () => ({ value }),
  getRangeState: () => ({ value: [[value]] }),
  setCellValue: (_reference, next) => {
    value = next;
    for (const listener of listeners) listener({ value });
  },
  insertRowsWithValues: () => {},
  subscribeCell: (_reference, listener) => {
    listeners.add(listener);
    listener({ value });
    return {
      dispose: () => {
        listeners.delete(listener);
      },
    };
  },
  subscribeRange: (_reference, listener) => {
    listener({ value: [[value]] });
    return { dispose() {} };
  },
  getCollaborationStatus: () => CollaborationStatus.SYNCED,
  subscribeCollaborationStatus: (listener) => {
    listener(CollaborationStatus.SYNCED);
    return { dispose() {} };
  },
  flush: async () => {
    if (offline) throw new Error("Fixture offline");
  },
  dispose: () => {
    disposed++;
  },
});

function Preview() {
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      mountRetainedHtmlView({
        anchor: anchor.current!,
        source,
        name: "Lifecycle fixture",
        locale: new URLSearchParams(location.search).get("lang") === "zh-CN" ? "zh-CN" : "en-US",
        loadEngine,
        t: (key) =>
          ({
            "html.inspect":
              new URLSearchParams(location.search).get("lang") === "zh-CN"
                ? "检查绑定"
                : "Inspect bindings",
            "html.saving": "Saving",
            "html.saveFailed": "Save failed",
            "html.retrySave": "Save and close",
          })[key] ?? key,
      }),
    [],
  );
  return <div ref={anchor} style={{ height: 400, width: "80vw", border: "1px solid black" }} />;
}
function Fixture() {
  const [open, setOpen] = useState(true);
  const [message, setMessage] = useState("");
  return (
    <>
      <button onClick={() => setOpen(false)}>Close native tab</button>
      <button
        onClick={() => {
          offline = true;
        }}
      >
        Go offline
      </button>
      <button
        onClick={() => {
          offline = false;
        }}
      >
        Reconnect
      </button>
      <button
        onClick={() => {
          value = "Remote update";
          for (const listener of listeners) listener({ value });
        }}
      >
        Remote update
      </button>
      <button onClick={() => setMessage(`Disposed: ${disposed}; value: ${value}`)}>
        Inspect engine
      </button>
      <p>{message}</p>
      {open ? <Preview /> : null}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
