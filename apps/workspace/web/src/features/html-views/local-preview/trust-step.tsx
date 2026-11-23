import type { HtmlViewBinding } from "@univerjs-labs/html-view";
import { Button } from "../../../shared/ui";
import { unitLabel, type BoundUnits } from "./bound-units";
import { usePreviewMessages } from "./messages";

/** Shown before any data connects. It lists what the page names, using only the page text and resource names. */
export function TrustStep({ bindings, units, fileName, sourceLabel, onConfirm, pick }: {
  bindings: readonly HtmlViewBinding[];
  units: BoundUnits;
  fileName: string;
  sourceLabel: string;
  onConfirm: () => void;
  pick: () => void;
}) {
  const m = usePreviewMessages();
  const sheets = new Map<string, Map<string, number>>();
  for (const { reference } of bindings) {
    const unit = sheets.get(reference.unitId) ?? new Map<string, number>();
    unit.set(reference.sheetId, (unit.get(reference.sheetId) ?? 0) + 1);
    sheets.set(reference.unitId, unit);
  }
  return <section aria-labelledby="preview-trust-title" className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
    <h2 id="preview-trust-title" className="m-0 text-lg font-semibold">{m.trustTitle}</h2>
    <p className="m-0 text-sm">{m.trustBody}</p>
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">{m.file}</dt><dd className="m-0 break-all">{fileName}</dd>
      <dt className="text-muted-foreground">{m.source}</dt><dd className="m-0 break-all">{sourceLabel}</dd>
    </dl>
    <div>
      <h3 className="m-0 mb-1 text-sm font-medium">{m.trustUnits}</h3>
      {sheets.size === 0 ? <p className="m-0 text-sm text-muted-foreground">{m.trustNoSheets}</p> :
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
          {[...sheets].map(([unitId, unitSheets]) =>
            <li key={unitId} className="rounded-md border border-border p-3">
              <div className="font-medium">{unitLabel(units.get(unitId), m)}</div>
              <code className="break-all text-xs text-muted-foreground">{unitId}</code>
              <div className="mt-1 text-muted-foreground">
                {m.trustSheets}: {[...unitSheets].map(([sheetId, count]) => `${sheetId} (${m.trustBindings(count)})`).join(", ")}
              </div>
            </li>)}
        </ul>}
    </div>
    <div className="flex gap-2">
      <Button onClick={onConfirm}>{m.trustConfirm}</Button>
      <Button variant="secondary" onClick={pick}>{m.trustLeave}</Button>
    </div>
  </section>;
}
