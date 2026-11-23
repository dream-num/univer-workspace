import type { HtmlViewBinding } from "@univerjs-labs/html-view";
import { Check, CircleCheck, Lock, Sheet, Shield } from "lucide-react";
import { useI18n } from "../../../shared/i18n";
import { Badge, Button, Skeleton } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import { bindingAddress, byPosition } from "./bindings";
import { unitLabel, type BoundUnit, type BoundUnits } from "./bound-units";
import { usePreviewMessages } from "./messages";
import { PageBox, StepCard, StepLink, StepNote } from "./step-card";

const MAX_ADDRESSES = 12;

/** Shown before any data connects. It asks only about the Units not yet trusted, named from the page text and Resource lookups. */
export function TrustStep({ bindings, units, trusted, fileName, source, pullRequest, canAlways, onTrust, pick }: {
  bindings: readonly HtmlViewBinding[];
  units: BoundUnits;
  trusted: ReadonlySet<string>;
  fileName: string;
  source: string;
  pullRequest: { repo: string; pr: number } | undefined;
  /** False without a signed-in user to remember the choice for. */
  canAlways: boolean;
  onTrust: (scope: "always" | "session") => void;
  pick: () => void;
}) {
  const m = usePreviewMessages();
  const { language } = useI18n();
  const asking = [...units.values()].filter((unit) => !trusted.has(unit.unitId));
  const known = [...units.values()].filter((unit) => trusted.has(unit.unitId));
  const added = known.length > 0;
  return <StepCard icon={Shield} title={added ? m.trustTitleAdded(asking.length) : m.trustTitle} lead={added ? m.trustLeadAdded : m.trustLead}
    footer={<>
      {canAlways && <Button onClick={() => onTrust("always")}><Check />{m.trustAlways}</Button>}
      <Button variant={canAlways ? "secondary" : "primary"} onClick={() => onTrust("session")}>{m.trustOnce}</Button>
      <StepLink onClick={pick}>{m.pickAnother}</StepLink>
      {canAlways && <p className="m-0 basis-full text-xs leading-relaxed text-subtle-foreground">{m.trustAlwaysHint}</p>}
    </>}>
    <div>
      <h3 className="m-0 mb-2 text-xs font-semibold text-subtle-foreground">{m.trustPage}</h3>
      <PageBox name={fileName} source={source} pullRequest={pullRequest} />
    </div>
    <div>
      <h3 className="m-0 mb-2 text-xs font-semibold text-subtle-foreground">{m.trustReads(asking.length)}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {asking.map((unit) => <UnitCard key={unit.unitId} unit={unit} added={added}
          bindings={bindings.filter((binding) => binding.reference.unitId === unit.unitId)} />)}
      </ul>
      {added && <p className="m-0 mt-2.5 flex items-center gap-2 text-[13px] text-muted-foreground">
        <CircleCheck className="size-3.5 shrink-0 text-success" />
        {m.trustAlready(new Intl.ListFormat(language).format(known.map((unit) => unitLabel(unit, m))), known.length)}
      </p>}
    </div>
    <StepNote>{pullRequest ? m.trustNotePr(pullRequest.pr) : m.trustNote}</StepNote>
  </StepCard>;
}

function UnitCard({ unit, bindings, added }: { unit: BoundUnit; bindings: readonly HtmlViewBinding[]; added: boolean }) {
  const m = usePreviewMessages();
  const denied = unit.status === "denied";
  const addresses = [...new Set([...bindings].sort(byPosition).map(bindingAddress))];
  const chip = "rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground";
  return <li className={cn("flex gap-3 rounded-md border border-border px-3.5 py-3", denied && "bg-surface", added && "border-primary/45 ring-3 ring-primary/10")}>
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-md [&_svg]:size-4", denied ? "bg-muted text-subtle-foreground" : "bg-sheet-soft text-sheet")}>
      {denied ? <Lock /> : <Sheet />}
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        {unit.status === "loading" ? <Skeleton className="h-4 w-36" /> : <span className="font-semibold break-all">{unitLabel(unit, m)}</span>}
        {denied ? <Badge variant="danger">{m.trustDenied}</Badge> : unit.canEdit !== undefined && <Badge>{unit.canEdit ? m.roleEdit : m.roleView}</Badge>}
      </div>
      {denied ? <>
        <p className="m-0 mt-1 text-xs text-subtle-foreground">{m.trustDeniedBody}</p>
        <code className="mt-1 block font-mono text-[11px] break-all text-subtle-foreground">{unit.unitId}</code>
      </> : <>
        <div className="mt-0.5 text-xs text-subtle-foreground">{m.trustUnitStats(new Set(bindings.map((binding) => binding.reference.sheetId)).size, bindings.length)}</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {addresses.slice(0, MAX_ADDRESSES).map((address) => <code key={address} className={chip}>{address}</code>)}
          {addresses.length > MAX_ADDRESSES && <code className={chip}>+{addresses.length - MAX_ADDRESSES}</code>}
        </div>
      </>}
    </div>
  </li>;
}
