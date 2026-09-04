import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  type UIEvent,
} from "react";
import { Badge } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { useI18n } from "../../shared/i18n";
import {
  baseDiffFieldLabel,
  baseTableIdOfDiffItem,
  buildBaseDiffGridLayout,
  buildBaseTableDiff,
  getBaseDiffCell,
  type BaseDiffCell,
  type BaseDiffField,
  type BaseDiffRecord,
  type BaseTableDiff,
} from "./base-table-diff";
import type { StructuralDiffItem } from "./comparison-presentation";

type DiffKind = StructuralDiffItem["kind"];

export function BaseTableDiffViewer(input: {
  readonly fidelity: "history" | "snapshot";
  readonly items: readonly StructuralDiffItem[];
  readonly left: unknown;
  readonly leftLabel: string;
  readonly leftSourceControl: ReactNode;
  readonly right: unknown;
  readonly rightLabel: string;
}): ReactElement {
  const tables = useMemo(
    () => buildBaseTableDiff(input.left, input.right, input.items),
    [input.items, input.left, input.right]
  );
  const visibleItems = useMemo(
    () => input.items.filter((item) => isVisibleBaseDiffItem(item, tables)),
    [input.items, tables]
  );
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const activeTable = tables.find((table) => table.id === activeTableId) ?? tables[0] ?? null;
  const scopedItems = useMemo(
    () =>
      activeTable === null
        ? []
        : visibleItems.filter((item) => baseTableIdOfDiffItem(item) === activeTable.id),
    [activeTable, visibleItems]
  );
  const selectedItem = scopedItems.find((item) => item.id === selectedItemId);

  useEffect(() => {
    setActiveTableId(activeTable?.id ?? null);
  }, [activeTable?.id]);
  useEffect(() => {
    if (selectedItemId !== undefined && selectedItem === undefined) setSelectedItemId(undefined);
  }, [selectedItem, selectedItemId]);

  const selectItem = (item: StructuralDiffItem): void => {
    setSelectedItemId(item.id);
    const tableId = baseTableIdOfDiffItem(item);
    if (tableId !== null && tables.some((table) => table.id === tableId)) {
      setActiveTableId(tableId);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-2">
      <div className="grid h-full min-h-[420px] grid-cols-[240px_minmax(720px,1fr)] overflow-hidden rounded-xl border border-border bg-border shadow-[0_12px_32px_rgb(15_23_42/0.08),0_1px_2px_rgb(15_23_42/0.06)] max-[1023px]:grid-cols-1">
        <BaseDiffSidebar
          fidelity={input.fidelity}
          items={scopedItems}
          selectedItemId={selectedItem?.id}
          tables={tables}
          onClear={() => setSelectedItemId(undefined)}
          onSelect={selectItem}
        />
        <BaseDiffPanes
          activeTable={activeTable}
          leftLabel={input.leftLabel}
          leftSourceControl={input.leftSourceControl}
          rightLabel={input.rightLabel}
          selectedItem={selectedItem}
          tables={tables}
          onSelectTable={(tableId) => {
            setSelectedItemId(undefined);
            setActiveTableId(tableId);
          }}
        />
      </div>
    </div>
  );
}

function BaseDiffSidebar(input: {
  readonly fidelity: "history" | "snapshot";
  readonly items: readonly StructuralDiffItem[];
  readonly selectedItemId: string | undefined;
  readonly tables: readonly BaseTableDiff[];
  readonly onClear: () => void;
  readonly onSelect: (item: StructuralDiffItem) => void;
}): ReactElement {
  const { language, t } = useI18n();
  return (
    <aside
      className="min-h-0 overflow-auto border-r bg-card p-3 max-[1023px]:hidden"
      onClick={(event) => {
        if (event.target === event.currentTarget) input.onClear();
      }}
    >
      <div className="mb-3 flex items-center justify-between border-b border-border pb-3 text-xs font-semibold">
        <div className="grid gap-0.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {t("comparisonChanges")}
          </span>
          <span className="text-[13px] text-foreground">
            {language === "zh-CN" ? "原始表格数据" : "Raw table data"}
          </span>
        </div>
        <Badge>{input.items.length}</Badge>
      </div>
      <p className="mt-0 mb-3 text-[10px] leading-4 text-muted-foreground">
        {language === "zh-CN"
          ? "两侧使用相同的字段与记录顺序，以保持表格对齐。"
          : "Both sides use the same field and record order to stay aligned."}
      </p>
      {input.fidelity === "snapshot" ? (
        <div className="mb-2 rounded-md border border-warning/35 bg-warning-muted p-2 text-[11px] leading-4 text-warning">
          {t("comparisonSnapshot")}
        </div>
      ) : null}
      <div className="space-y-1.5">
        {input.items.map((item) => {
          const selected = input.selectedItemId === item.id;
          return (
            <button
              aria-pressed={selected}
              className={cn(
                "block w-full rounded-lg border px-2.5 py-2 text-left text-[11px] leading-4 outline-none transition-[border-color,background,box-shadow,transform] hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring",
                toneClass(item.kind),
                selected && "ring-2 ring-ring ring-offset-1 ring-offset-background"
              )}
              data-diff-sidebar-selected={selected ? "true" : undefined}
              key={item.id}
              type="button"
              onClick={() => input.onSelect(item)}
            >
              <div className="truncate font-medium">{itemDisplayLabel(item, input.tables)}</div>
              <div className="truncate opacity-70">
                {item.entityType.replaceAll("-", " ")} · {t(kindKey(item.kind))}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function BaseDiffPanes(input: {
  readonly activeTable: BaseTableDiff | null;
  readonly leftLabel: string;
  readonly leftSourceControl: ReactNode;
  readonly rightLabel: string;
  readonly selectedItem: StructuralDiffItem | undefined;
  readonly tables: readonly BaseTableDiff[];
  readonly onSelectTable: (tableId: string) => void;
}): ReactElement {
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const syncing = useRef<"left" | "right" | null>(null);
  useEffect(() => {
    syncing.current = null;
    for (const element of [leftRef.current, rightRef.current]) {
      if (element !== null) element.scrollTo({ left: 0, top: 0 });
    }
  }, [input.activeTable?.id]);
  const sync = (side: "left" | "right", event: UIEvent<HTMLDivElement>): void => {
    if (syncing.current !== null && syncing.current !== side) return;
    const target = side === "left" ? rightRef.current : leftRef.current;
    if (target === null) return;
    syncing.current = side;
    target.scrollLeft = event.currentTarget.scrollLeft;
    target.scrollTop = event.currentTarget.scrollTop;
    requestAnimationFrame(() => {
      syncing.current = null;
    });
  };
  const tabs = input.tables.map((table) => ({ id: table.id, label: table.label, status: table.status }));
  return (
    <div className="grid min-h-0 grid-cols-2 gap-px bg-border max-[1023px]:grid-cols-1" data-testid="base-diff-panes">
      <BaseDiffPane {...input} label={input.leftLabel} scrollRef={leftRef} side="left" sourceControl={input.leftSourceControl} tabs={tabs} onScroll={(event) => sync("left", event)} />
      <BaseDiffPane {...input} label={input.rightLabel} scrollRef={rightRef} side="right" sourceControl={undefined} tabs={tabs} onScroll={(event) => sync("right", event)} />
    </div>
  );
}

function BaseDiffPane(input: {
  readonly activeTable: BaseTableDiff | null;
  readonly label: string;
  readonly scrollRef: MutableRefObject<HTMLDivElement | null>;
  readonly selectedItem: StructuralDiffItem | undefined;
  readonly side: "left" | "right";
  readonly sourceControl: ReactNode | undefined;
  readonly tabs: readonly { readonly id: string; readonly label: string; readonly status: DiffKind }[];
  readonly onScroll: (event: UIEvent<HTMLDivElement>) => void;
  readonly onSelectTable: (tableId: string) => void;
}): ReactElement {
  const { language } = useI18n();
  return (
    <section className="grid min-h-0 grid-rows-[56px_auto_minmax(0,1fr)] bg-background">
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
        {input.sourceControl ?? (
          <div className="grid min-w-0 gap-0.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
              {input.side === "left" ? "LEFT · COMPARE WITH" : "RIGHT · CURRENT VERSION"}
            </span>
            <span className="truncate text-[12px] font-semibold">{input.label}</span>
          </div>
        )}
        <span className="rounded-full border border-border bg-muted/55 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          {language === "zh-CN" ? "只读" : "READ ONLY"}
        </span>
      </header>
      <PageTabs activeId={input.activeTable?.id ?? null} options={input.tabs} onSelect={input.onSelectTable} />
      {input.activeTable === null ? (
        <div className="grid place-items-center bg-card text-sm text-muted-foreground">—</div>
      ) : (
        <BaseRawTableGrid {...input} table={input.activeTable} />
      )}
    </section>
  );
}

function PageTabs(input: {
  readonly activeId: string | null;
  readonly options: readonly { readonly id: string; readonly label: string; readonly status: DiffKind }[];
  readonly onSelect: (id: string) => void;
}): ReactElement {
  return (
    <div className="flex min-h-10 items-end gap-1 overflow-x-auto border-b border-border bg-card px-3 pt-1.5">
      {input.options.map((option) => (
        <button
          className={cn(
            "relative h-8 shrink-0 rounded-t-md border border-b-0 px-3 text-[11px] font-semibold",
            option.id === input.activeId ? "border-border bg-background text-foreground" : "border-transparent text-muted-foreground hover:bg-muted"
          )}
          key={option.id}
          type="button"
          onClick={() => input.onSelect(option.id)}
        >
          {option.label}
          <span className={cn("absolute inset-x-0 top-0 h-0.5", option.status === "insert" ? "bg-diff-insert" : option.status === "delete" ? "bg-diff-delete" : "bg-diff-update")} />
        </button>
      ))}
    </div>
  );
}

function BaseRawTableGrid(input: {
  readonly scrollRef: MutableRefObject<HTMLDivElement | null>;
  readonly selectedItem: StructuralDiffItem | undefined;
  readonly side: "left" | "right";
  readonly table: BaseTableDiff;
  readonly onScroll: (event: UIEvent<HTMLDivElement>) => void;
}): ReactElement {
  const layout = buildBaseDiffGridLayout(input.table);
  return (
    <div ref={input.scrollRef} className="min-h-0 overflow-auto bg-card" onScroll={input.onScroll}>
      <div className="grid text-[11px]" style={{ gridTemplateColumns: layout.gridTemplateColumns, width: layout.totalWidth }} data-testid={`base-raw-diff-${input.side}`}>
        <div className="sticky top-0 left-0 z-30 grid h-10 place-items-center border-r border-b border-border bg-muted/85"><span className="size-3.5 rounded border border-border bg-card" /></div>
        {input.table.fields.map((field) => <BaseFieldHeader field={field} key={field.id} selectedItem={input.selectedItem} side={input.side} />)}
        {input.table.records.map((record, index) => <BaseRecordRow fields={input.table.fields} index={index} key={record.id} record={record} selectedItem={input.selectedItem} side={input.side} />)}
      </div>
    </div>
  );
}

function BaseFieldHeader(input: { readonly field: BaseDiffField; readonly selectedItem: StructuralDiffItem | undefined; readonly side: "left" | "right" }): ReactElement {
  const field = input.field[input.side];
  const selected = input.selectedItem?.entityType === "field" && input.selectedItem.stableId === input.field.id;
  return <div className={cn("sticky top-0 z-20 flex h-10 min-w-0 items-center border-r border-b border-border bg-muted/85 px-3 font-semibold", toneClass(sideStatus(input.field.left, input.field.right, input.field.status, input.side), selected))}><span className="truncate">{field === null ? "—" : baseDiffFieldLabel(input.field, input.side)}</span></div>;
}

function BaseRecordRow(input: { readonly fields: readonly BaseDiffField[]; readonly index: number; readonly record: BaseDiffRecord; readonly selectedItem: StructuralDiffItem | undefined; readonly side: "left" | "right" }): ReactElement {
  const rowSelected = input.selectedItem?.entityType === "record" && input.selectedItem.stableId === input.record.id;
  return <><div className={cn("sticky left-0 z-10 grid min-h-9 place-items-center border-r border-b border-border bg-muted/70", toneClass(sideStatus(input.record.left, input.record.right, input.record.status, input.side), rowSelected))}>{input.index + 1}</div>{input.fields.map((field) => { const cell = getBaseDiffCell({ field, record: input.record, side: input.side }); const selected = input.selectedItem?.entityType === "cell" && input.selectedItem.stableId === `${input.record.id}:${field.id}`; return <div className={cn("flex min-h-9 min-w-0 items-center border-r border-b border-border bg-card px-3", toneClass(cell.status, selected), !cell.present && "bg-muted/35")} key={`${input.record.id}:${field.id}`}><BaseCellContent cell={cell} /></div>; })}</>;
}

function BaseCellContent({ cell }: { readonly cell: BaseDiffCell }): ReactElement {
  return <span className={cn("truncate", !cell.present && "italic text-muted-foreground")}>{cell.present ? cell.displayValue : "—"}</span>;
}

function sideStatus(left: object | null, right: object | null, status: DiffKind | null, side: "left" | "right"): DiffKind | null {
  if (left === null || right === null) return side === "left" ? "delete" : "insert";
  return status;
}

function toneClass(status: DiffKind | null, selected = false): string {
  if (status === null) return "";
  const basic = status === "insert" ? "border-diff-insert/40 bg-diff-insert-muted/80 text-diff-insert" : status === "delete" ? "border-diff-delete/40 bg-diff-delete-muted/80 text-diff-delete" : "border-diff-update/40 bg-diff-update-muted/75 text-diff-update";
  return cn(basic, selected && "ring-2 ring-inset ring-current/70");
}

function isVisibleBaseDiffItem(item: StructuralDiffItem, tables: readonly BaseTableDiff[]): boolean {
  if (item.category.startsWith("view:")) return false;
  if (!item.category.startsWith("field:")) return true;
  const table = tables.find((candidate) => candidate.id === baseTableIdOfDiffItem(item));
  return table === undefined || table.fields.some((field) => field.id === item.stableId);
}

function itemDisplayLabel(item: StructuralDiffItem, tables: readonly BaseTableDiff[]): string {
  const table = tables.find((candidate) => candidate.id === baseTableIdOfDiffItem(item));
  if (table === undefined) return item.label;
  if (item.entityType === "field") return table.fields.find((field) => field.id === item.stableId)?.label ?? item.label;
  if (item.entityType === "record") return table.records.find((record) => record.id === item.stableId)?.label ?? item.label;
  return table.label;
}

function kindKey(kind: DiffKind): "comparisonKindInsert" | "comparisonKindDelete" | "comparisonKindUpdate" {
  return kind === "insert" ? "comparisonKindInsert" : kind === "delete" ? "comparisonKindDelete" : "comparisonKindUpdate";
}
