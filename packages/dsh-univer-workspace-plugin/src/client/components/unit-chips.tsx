/**
 * Navigation chips for the units changed by a worktree — ported from the
 * dsh-univer-office UnitChips.
 * @module dsh-univer-workspace-plugin/client/components/unit-chips
 */

import * as React from "react";
import type { ChangedUnit } from "../../shared/state.ts";
import type { UniverLocaleKey } from "../locales.ts";

const ICONS: Record<ChangedUnit["kind"], string> = { modified: "✎", added: "＋", deleted: "－", unchanged: "•" };

/** Unit switcher chips; hidden while a worktree changes a single unit. */
export function UnitChips(props: {
  readonly units: readonly ChangedUnit[];
  readonly selected: string | undefined;
  readonly t: (key: UniverLocaleKey) => string;
  readonly onSelect: (unitId: string) => void;
}): React.ReactElement | null {
  if (props.units.length <= 1) return null;
  return <div className="uvf_units">{props.units.map((unit) => <button
    key={unit.unitId}
    type="button"
    className={`uvf_unit${unit.unitId === props.selected ? " uvf_unit_on" : ""}`}
    data-kind={unit.kind}
    title={props.t(`dock.unit.${unit.kind}` as UniverLocaleKey)}
    onClick={() => props.onSelect(unit.unitId)}
  ><span className="uvf_unit_icon">{ICONS[unit.kind]}</span>{unit.name || props.t(`dock.unit.${unit.kind}` as UniverLocaleKey)}</button>)}</div>;
}
