import { Check, CircleCheck, CircleX, Info, LoaderCircle, Sheet, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import { bindingAddress, byPosition, isEmpty, type BindingSample } from "./bindings";
import { unitLabel, type BoundUnits } from "./bound-units";
import { usePreviewMessages } from "./messages";
import type { LocalPreviewReport } from "./report";

export type ReportDelivery = "pending" | "sent" | "failed" | "local";

export interface CheckResult {
  report: LocalPreviewReport;
  samples: readonly BindingSample[];
  delivery: ReportDelivery;
}

type Tone = "success" | "warning" | "danger";
const TONES: Record<Tone, { icon: LucideIcon; banner: string; mark: string }> = {
  success: { icon: CircleCheck, banner: "bg-success-soft text-success-soft-foreground", mark: "text-success" },
  warning: { icon: TriangleAlert, banner: "bg-warning-soft text-warning-soft-foreground", mark: "text-warning" },
  danger: { icon: CircleX, banner: "bg-destructive-soft text-destructive-soft-foreground", mark: "text-destructive" },
};
const DELIVERY: Record<ReportDelivery, { icon: LucideIcon; className: string }> = {
  pending: { icon: LoaderCircle, className: "[&_svg]:animate-spin" },
  sent: { icon: Check, className: "text-success" },
  failed: { icon: CircleX, className: "text-destructive" },
  local: { icon: Info, className: "" },
};

export function DiagnosticsPanel({ result, units }: { result: CheckResult | null; units: BoundUnits }) {
  const m = usePreviewMessages();
  const { language } = useI18n();
  const numbers = new Intl.NumberFormat(language, { maximumFractionDigits: 4 });
  const report = result?.report;
  const Delivery = result && DELIVERY[result.delivery];
  return <aside aria-label={m.diagnostics} className="flex w-92 shrink-0 flex-col border-l border-border bg-background text-sm">
    <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
      <h2 className="m-0 text-sm font-semibold">{m.diagnostics}</h2>
      {report && <Badge className="ml-auto tabular-nums">{report.viewport.width} × {report.viewport.height}</Badge>}
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
      {!result ? <p role="status" className="m-0 text-muted-foreground">{m.checking}</p> : <>
        <Verdict report={result.report} samples={result.samples} />
        <Checks report={result.report} samples={result.samples} />
        <Bindings samples={result.samples} units={units} format={(value) => numbers.format(value)} />
      </>}
    </div>
    {result && Delivery && <p className="m-0 flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5 text-xs text-subtle-foreground">
      <span className={cn("inline-flex items-center gap-1 [&_svg]:size-3.5", Delivery.className)}><Delivery.icon />{m.delivery[result.delivery]}</span>
      <span aria-hidden="true">·</span>
      <span>{m.hash} <code className="font-mono">{result.report.sha256.slice(0, 12)}</code></span>
    </p>}
  </aside>;
}

function Verdict({ report, samples }: { report: LocalPreviewReport; samples: readonly BindingSample[] }) {
  const m = usePreviewMessages();
  const { language } = useI18n();
  const { status, reason, issues, durationMs } = report.renderCheck;
  const took = m.took(new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(durationMs / 1000));
  const problems = issues.length + samples.filter((sample) => sample.warnings.length > 0).length + report.leftoverPlaceholders.length;
  const verdict: { tone: Tone; title: string; took?: string; detail?: string | undefined } =
    status === "failed" ? { tone: "danger", title: m.verdictFailed, detail: reason }
    : status === "timed-out" ? { tone: "warning", title: m.verdictTimedOut, detail: reason }
    : problems > 0 ? { tone: "warning", title: m.verdictProblems(problems), took }
    : { tone: "success", title: m.verdictPassed, took, detail: samples.length > 0 ? m.allRead(samples.length) : m.noBindings };
  const Icon = TONES[verdict.tone].icon;
  return <div data-testid="preview-status" data-status={status} className={cn("flex items-start gap-2.5 rounded-md px-3.5 py-3", TONES[verdict.tone].banner)}>
    <Icon className="mt-0.5 size-4.5 shrink-0" />
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 font-semibold">{verdict.title}{verdict.took && <small className="text-xs font-medium opacity-80">{verdict.took}</small>}</div>
      {verdict.detail && <div className="mt-0.5 text-xs break-words text-muted-foreground">{verdict.detail}</div>}
    </div>
  </div>;
}

function Checks({ report, samples }: { report: LocalPreviewReport; samples: readonly BindingSample[] }) {
  const m = usePreviewMessages();
  const { issues } = report.renderCheck;
  const placeholders = report.leftoverPlaceholders;
  const ok = samples.filter((sample) => sample.warnings.length === 0).length;
  return <div className="flex flex-col divide-y divide-border rounded-md border border-border">
    <CheckRow tone={issues.length > 0 ? "danger" : "success"} title={m.checkErrors} value={issues.length > 0 ? m.errorCount(issues.length) : m.none}>
      {issues.map((issue) => <li key={`${issue.kind}:${issue.message}`}>
        <Badge variant="danger" className="mr-1.5 rounded-sm">{m.issueKinds[issue.kind]}</Badge>
        <code className="font-mono text-xs">{issue.message}</code>
      </li>)}
    </CheckRow>
    <CheckRow tone={ok < samples.length ? "warning" : "success"} title={m.checkValues} value={m.valuesOk(ok, samples.length)} />
    <CheckRow tone={placeholders.length > 0 ? "warning" : "success"} title={m.checkPlaceholders} value={placeholders.length > 0 ? m.placeholderCount(placeholders.length) : m.none}>
      {placeholders.map((text) => <li key={text}>
        {m.stillVisible} <span className="rounded-sm bg-warning-soft px-1.5 py-px text-warning-soft-foreground">{text}</span>
      </li>)}
    </CheckRow>
  </div>;
}

function CheckRow({ tone, title, value, children }: { tone: Tone; title: string; value: string; children?: ReactNode[] }) {
  const Icon = TONES[tone].icon;
  return <div className="flex items-start gap-2.5 px-3 py-2.5">
    <Icon className={cn("mt-0.5 size-4 shrink-0", TONES[tone].mark)} />
    <div className="min-w-0 flex-1">
      <div className="font-medium">{title}</div>
      {children && children.length > 0 && <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0 text-xs break-words text-muted-foreground">{children}</ul>}
    </div>
    <span className="text-xs whitespace-nowrap text-subtle-foreground">{value}</span>
  </div>;
}

function Bindings({ samples, units, format }: { samples: readonly BindingSample[]; units: BoundUnits; format: (value: number) => string }) {
  const m = usePreviewMessages();
  const groups = new Map<string, BindingSample[]>();
  for (const sample of samples) {
    const key = `${sample.binding.reference.unitId}\n${sample.binding.reference.sheetId}`;
    groups.set(key, [...groups.get(key) ?? [], sample]);
  }
  return <section className="flex flex-col gap-2">
    <h3 className="m-0 flex items-center gap-1.5 text-xs font-semibold text-subtle-foreground">
      {m.bindings}<Badge className="px-1.5 py-0 tabular-nums">{samples.length}</Badge>
    </h3>
    {samples.length === 0 ? <p className="m-0 text-muted-foreground">{m.noBindings}</p> : [...groups].map(([key, group]) => {
      const sheetName = group.find((sample) => sample.sheetName !== undefined)?.sheetName;
      return <div key={key} className="overflow-hidden rounded-md border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2 text-[13px] font-semibold">
          <Sheet className="size-3.5 shrink-0 text-sheet" />
          <span className="min-w-0 truncate">{unitLabel(units.get(group[0]!.binding.reference.unitId), m)}</span>
          {sheetName !== undefined && <span className="min-w-0 truncate font-medium text-subtle-foreground">› {sheetName}</span>}
        </div>
        <table className="w-full border-collapse text-xs">
          <tbody>
            {[...group].sort((a, b) => byPosition(a.binding, b.binding)).map((sample, index) =>
              <tr key={index} title={`${sample.attribute} ${sample.reference}`}
                className={cn("border-t border-border align-top first:border-t-0", sample.warnings.length > 0 && "bg-warning-soft/60")}>
                <td className="w-16 py-1.5 pr-2 pl-3 font-mono font-medium whitespace-nowrap">{bindingAddress(sample.binding)}</td>
                <td className="w-14 px-2 py-1.5 whitespace-nowrap text-subtle-foreground">{m.bindingKinds[sample.binding.kind]}</td>
                <td className="py-1.5 pr-3 pl-2 break-words tabular-nums">
                  <SampleValue sample={sample} format={format} />
                  {sample.warnings.map((warning) => <div key={warning} className="mt-0.5 flex items-center gap-1 text-warning-soft-foreground">
                    <TriangleAlert className="size-3 shrink-0" />{m.warnings[warning]}
                  </div>)}
                </td>
              </tr>)}
          </tbody>
        </table>
      </div>;
    })}
  </section>;
}

function SampleValue({ sample: { binding, sample }, format }: { sample: BindingSample; format: (value: number) => string }) {
  const m = usePreviewMessages();
  const text = (value: unknown) => typeof value === "number" ? format(value) : isEmpty(value) ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const emptyLabel = <span className="text-subtle-foreground">{m.empty}</span>;
  if (binding.kind !== "range") return isEmpty(sample) ? emptyLabel : typeof sample === "number" ? <span title={String(sample)}>{format(sample)}</span> : <>{text(sample)}</>;
  const cells = Array.isArray(sample) ? sample : [];
  const more = binding.reference.range.endRow - binding.reference.range.startRow;
  return <>
    {cells.every(isEmpty) ? emptyLabel : cells.map(text).join(" · ")}
    {more > 0 && <span className="ml-1.5 whitespace-nowrap text-subtle-foreground">{m.moreRows(more)}</span>}
  </>;
}
