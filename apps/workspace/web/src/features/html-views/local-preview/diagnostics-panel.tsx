import type { LocalPreviewReport } from "./report";
import { usePreviewMessages } from "./messages";

export type ReportDelivery = "pending" | "sent" | "failed" | "local";

const show = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value) ?? "");

export function DiagnosticsPanel({ result }: { result: { report: LocalPreviewReport; delivery: ReportDelivery } | null }) {
  const m = usePreviewMessages();
  const report = result?.report;
  return <aside aria-label={m.diagnostics} className="flex w-80 shrink-0 flex-col gap-4 overflow-auto border-l border-border p-4 text-sm">
    <h2 className="m-0 text-base font-semibold">{m.diagnostics}</h2>
    {!report ? <p role="status" className="m-0 text-muted-foreground">{m.checking}</p> : <>
      <p data-testid="preview-status" data-status={report.renderCheck.status} className="m-0 font-medium">
        {m.status[report.renderCheck.status]} · {report.renderCheck.durationMs} ms
      </p>
      <section>
        <h3 className="m-0 mb-1 font-medium">{m.issues}</h3>
        {report.renderCheck.issues.length === 0 && !report.renderCheck.reason ? <p className="m-0 text-muted-foreground">{m.noIssues}</p> :
          <ul className="m-0 list-disc pl-5">
            {report.renderCheck.reason && <li>{report.renderCheck.reason}</li>}
            {report.renderCheck.issues.map((issue) => <li key={`${issue.kind}:${issue.message}`}><code>{issue.kind}</code> {issue.message}</li>)}
          </ul>}
      </section>
      <section>
        <h3 className="m-0 mb-1 font-medium">{m.bindings}</h3>
        {report.bindings.length === 0 ? <p className="m-0 text-muted-foreground">{m.noBindings}</p> :
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {report.bindings.map((binding, index) => <li key={index} className="break-words">
              <code className="text-xs">{binding.attribute.replace("data-univer-", "")} {binding.reference}</code>
              <div className="text-muted-foreground">{show(binding.sample)}</div>
              {binding.warnings.map((warning) => <div key={warning} className="text-amber-700">{m.warnings[warning]}</div>)}
            </li>)}
          </ul>}
      </section>
      <section>
        <h3 className="m-0 mb-1 font-medium">{m.placeholders}</h3>
        {report.leftoverPlaceholders.length === 0 ? <p className="m-0 text-muted-foreground">{m.noPlaceholders}</p> :
          <ul className="m-0 list-disc pl-5">{report.leftoverPlaceholders.map((text) => <li key={text}>{text}</li>)}</ul>}
      </section>
      <p className="m-0 text-xs text-muted-foreground">
        {report.viewport.width}×{report.viewport.height} · {m.hash} {report.sha256.slice(0, 12)}
        <br />
        {result.delivery === "sent" ? m.reportSent : result.delivery === "failed" ? m.reportFailed : result.delivery === "local" ? m.reportLocal : ""}
      </p>
    </>}
  </aside>;
}
