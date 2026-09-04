import { useQuery } from "@tanstack/react-query";
import {
  DocumentDataModel,
  IUniverInstanceService,
  UniverInstanceType,
  type IDocumentData,
  type IDisposable,
  type Workbook,
} from "@univerjs/core";
import type {
  IUnitComparisonItem,
  IUnitComparisonLeafChange,
  IUnitComparisonResult,
  IUnitComparisonScope,
} from "@univerjs-pro/edit-history";
import { ISlideDrawingStateService } from "@univerjs-pro/slides-ui";
import { FunctionSquare, RefreshCw, Search } from "lucide-react";
import { FWorkbook } from "@univerjs/sheets/facade";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type { components } from "../../../../generated/http/schema.js";
import { useI18n, type AppLanguage, type MessageKey } from "../../shared/i18n";
import { Alert, Badge, Button, Spinner } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { sessionQueryOptions } from "../auth";
import { ResourceEditor } from "../editor";
import {
  structuralDiffItemsFromResult,
  type DocumentParagraphAlignment,
  type StructuralDiffItem,
} from "./comparison-presentation";
import { decorateDocumentComparisonSide } from "./document-comparison-decoration";
import { createNativeComparisonHighlightController } from "./native-comparison-highlights";
import {
  focusPreviewComparisonTarget,
  structuralDiffFocusTarget,
} from "./preview-comparison-focus";
import { decorateWorkbookComparisonSide } from "./workbook-comparison-decoration";
import { comparisonSheetSelection } from "./workbook-comparison-selection";
import { worktreeUnitComparisonQueryOptions } from "./worktrees.queries";

type WorktreeUnit = components["schemas"]["WorktreeUnit"];
type Comparison = components["schemas"]["WorktreeUnitComparison"];
type UnitType = WorktreeUnit["unitType"];
type DiffKind = `${IUnitComparisonItem["kind"]}`;
type DisplayMode = "style" | "value";
type SidebarTab = "workbook" | "worksheet";

interface PageOption {
  readonly id: string;
  readonly label: string;
  readonly status: DiffKind;
}

interface ComparisonViewProps {
  readonly comparison: Comparison;
  readonly diff: IUnitComparisonResult;
  readonly sourceControl: ReactNode;
  readonly unit: WorktreeUnit;
  readonly user: {
    readonly id: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
  };
}

const STYLE_VALUE_TYPES = new Set(["color", "style"]);

/**
 * Keep the presentation aligned with univer-cli while consuming Workspace's one request-scoped
 * comparison package. No comparison session or Worktree-to-Worktree state is introduced here.
 */
export function WorktreeComparison({
  worktreeId,
  unit,
}: {
  readonly worktreeId: string;
  readonly unit: WorktreeUnit;
}) {
  const { t } = useI18n();
  const session = useQuery(sessionQueryOptions);
  const comparison = useQuery(
    worktreeUnitComparisonQueryOptions(worktreeId, unit.unitId)
  );

  if (comparison.isPending || !session.data?.authenticated) {
    return (
      <div className="grid h-full min-h-[480px] place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-5 text-brand-600" />
          {t("comparisonLoading")}
        </div>
      </div>
    );
  }
  if (comparison.isError) {
    return (
      <div className="p-4">
        <Alert variant="destructive" title={t("comparisonFailed")}>
          {comparison.error instanceof Error
            ? comparison.error.message
            : t("comparisonFailed")}
        </Alert>
        <Button className="mt-3" variant="secondary" onClick={() => void comparison.refetch()}>
          <RefreshCw />
          {t("refreshComparison")}
        </Button>
      </div>
    );
  }

  const value = comparison.data as Comparison;
  const diff = value.diff as unknown as IUnitComparisonResult;
  const sourceControl = (
    <ComparisonSourceControl
      label={t("officialVersion")}
      revision={value.left.revision}
      refreshing={comparison.isFetching}
      onRefresh={() => void comparison.refetch()}
    />
  );
  const props: ComparisonViewProps = {
    comparison: value,
    diff,
    sourceControl,
    unit,
    user: session.data.user,
  };

  return (
    <div className="flex min-h-[480px] flex-1 overflow-hidden">
      {unit.unitType === "sheet" ? (
        <WorkbookComparisonView {...props} />
      ) : (
        <NativeComparisonView {...props} />
      )}
    </div>
  );
}

function WorkbookComparisonView({
  comparison,
  diff,
  sourceControl,
  unit,
  user,
}: ComparisonViewProps): ReactElement {
  const { language, t } = useI18n();
  const [displayMode, setDisplayMode] = useState<DisplayMode>("value");
  const [showFormulaText, setShowFormulaText] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("worksheet");
  const [searchQuery, setSearchQuery] = useState("");
  const sheetOptions = useMemo(
    () => comparisonSheetOptions(diff, comparison.left.data, comparison.right.data),
    [comparison.left.data, comparison.right.data, diff]
  );
  const [activeSheetId, setActiveSheetId] = useState<string | null>(
    () => sheetOptions[0]?.id ?? null
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selectedSheetId = sheetOptions.some((sheet) => sheet.id === activeSheetId)
    ? activeSheetId
    : sheetOptions[0]?.id ?? null;
  const visibleItems = useMemo(
    () => filterWorkbookItems(diff.items, {
      displayMode,
      query: searchQuery,
      sheetId: sidebarTab === "worksheet" ? selectedSheetId : null,
      tab: sidebarTab,
    }),
    [diff.items, displayMode, searchQuery, selectedSheetId, sidebarTab]
  );
  const selectedItem = diff.items.find((item) => item.id === selectedItemId) ?? null;

  useEffect(() => {
    setDisplayMode("value");
    setShowFormulaText(false);
    setSidebarTab("worksheet");
    setSearchQuery("");
    setActiveSheetId(sheetOptions[0]?.id ?? null);
    setSelectedItemId(null);
  }, [diff.comparisonId]);

  const selectItem = (item: IUnitComparisonItem): void => {
    setSelectedItemId(item.id);
    const sheetId = item.scope?.stableId ?? item.parentStableId;
    if (sheetId && sheetOptions.some((sheet) => sheet.id === sheetId)) {
      setActiveSheetId(sheetId);
    }
  };
  const counts = diff.items.reduce(
    (result, item) => ({ ...result, [item.kind]: result[item.kind] + 1 }),
    { delete: 0, insert: 0, update: 0 }
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden p-2">
      <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card shadow-[0_12px_32px_rgb(15_23_42/0.08),0_1px_2px_rgb(15_23_42/0.06)]">
        <header className="grid min-h-16 gap-2 border-b border-border bg-[linear-gradient(180deg,var(--color-card),color-mix(in_srgb,var(--color-muted)_38%,var(--color-card)))] px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 h-9 w-1 shrink-0 rounded-full bg-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_10%,transparent)]" />
              <div className="grid min-w-0 gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="m-0 shrink-0 text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                    {t("comparisonWorkbookTitle")}
                  </p>
                  <h2 className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold">
                    {unit.name}
                  </h2>
                  <DiffSummaryPills counts={counts} />
                </div>
                <p className="m-0 text-[11px] leading-tight text-muted-foreground">
                  {t("comparisonDifferenceCount", { count: diff.items.length })}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CompactSegmentedControl
                options={[
                  { label: t("comparisonContent"), value: "value" },
                  { label: t("comparisonFormatting"), value: "style" },
                ]}
                value={displayMode}
                onChange={(value) => setDisplayMode(value as DisplayMode)}
              />
              <button
                aria-pressed={showFormulaText}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  showFormulaText
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                )}
                type="button"
                onClick={() => setShowFormulaText((value) => !value)}
              >
                <FunctionSquare aria-hidden="true" size={15} />
                {t("comparisonShowFormulas")}
              </button>
            </div>
          </div>
          {comparison.fidelity === "snapshot" ? (
            <div className="rounded-md border border-warning/25 bg-warning-muted px-3 py-1.5 text-[12px] leading-tight text-warning">
              {t("comparisonSnapshot")}
            </div>
          ) : null}
        </header>
        <div className="grid min-h-0 grid-cols-[268px_minmax(0,1fr)_minmax(0,1fr)] gap-px overflow-hidden bg-border max-[1023px]:grid-cols-1 max-[1023px]:grid-rows-2">
          <WorkbookSidebar
            items={visibleItems}
            language={language}
            query={searchQuery}
            selectedItemId={selectedItemId}
            tab={sidebarTab}
            onClear={() => setSelectedItemId(null)}
            onQueryChange={setSearchQuery}
            onSelect={selectItem}
            onTabChange={setSidebarTab}
          />
          <WorkbookDiffPane
            activeSheetId={selectedSheetId}
            data={comparison.left.data}
            item={selectedItem}
            items={diff.items}
            label={t("officialVersion")}
            revision={comparison.left.revision}
            sheetOptions={sheetOptions}
            showFormulaText={showFormulaText}
            side="left"
            sourceControl={sourceControl}
            unit={unit}
            user={user}
            onSelectSheet={setActiveSheetId}
          />
          <WorkbookDiffPane
            activeSheetId={selectedSheetId}
            data={comparison.right.data}
            item={selectedItem}
            items={diff.items}
            label={t("agentVersion")}
            revision={comparison.right.revision}
            sheetOptions={sheetOptions}
            showFormulaText={showFormulaText}
            side="right"
            sourceControl={undefined}
            unit={unit}
            user={user}
            onSelectSheet={setActiveSheetId}
          />
        </div>
      </section>
    </div>
  );
}

function WorkbookSidebar({
  items,
  language,
  query,
  selectedItemId,
  tab,
  onClear,
  onQueryChange,
  onSelect,
  onTabChange,
}: {
  readonly items: readonly IUnitComparisonItem[];
  readonly language: AppLanguage;
  readonly query: string;
  readonly selectedItemId: string | null;
  readonly tab: SidebarTab;
  readonly onClear: () => void;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (item: IUnitComparisonItem) => void;
  readonly onTabChange: (tab: SidebarTab) => void;
}): ReactElement {
  const { t } = useI18n();
  return (
    <aside
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-[color-mix(in_srgb,var(--color-muted)_52%,var(--color-card))] max-[1023px]:hidden"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClear();
      }}
    >
      <header className="grid gap-2 border-b border-border px-3 py-2.5">
        <CompactSegmentedControl
          fullWidth
          options={[
            { label: t("comparisonWorksheet"), value: "worksheet" },
            { label: t("comparisonWorkbook"), value: "workbook" },
          ]}
          value={tab}
          onChange={(value) => onTabChange(value as SidebarTab)}
        />
        <label className="relative block">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <input
            aria-label={t("comparisonSearchChanges")}
            className="h-9 w-full rounded-lg border border-input bg-card pr-3 pl-9 text-[12px] text-foreground shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            placeholder={t("comparisonSearchChanges")}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
      </header>
      <div className="min-h-0 overflow-auto px-3 py-3">
        {items.length === 0 ? (
          <div className="grid content-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            {t("comparisonNoItemsInScope")}
          </div>
        ) : (
          <div className="grid gap-1.5">
            {items.map((item) => (
              <DiffItemButton
                item={item}
                key={item.id}
                language={language}
                selected={selectedItemId === item.id}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function WorkbookDiffPane({
  activeSheetId,
  data,
  item,
  items,
  label,
  revision,
  sheetOptions,
  showFormulaText,
  side,
  sourceControl,
  unit,
  user,
  onSelectSheet,
}: {
  readonly activeSheetId: string | null;
  readonly data: Record<string, unknown> | undefined;
  readonly item: IUnitComparisonItem | null;
  readonly items: readonly IUnitComparisonItem[];
  readonly label: string;
  readonly revision: number | undefined;
  readonly sheetOptions: readonly PageOption[];
  readonly showFormulaText: boolean;
  readonly side: "left" | "right";
  readonly sourceControl: ReactNode | undefined;
  readonly unit: WorktreeUnit;
  readonly user: ComparisonViewProps["user"];
  readonly onSelectSheet: (id: string) => void;
}): ReactElement {
  const { language, t } = useI18n();
  const selectedText = item ? comparisonItemLabel(item, language) : "";
  const sheetSelection = useMemo(
    () => comparisonSheetSelection(item, side),
    [item, side]
  );
  const presentationItems = useMemo(
    () => structuralDiffItemsFromResult(items),
    [items]
  );
  const presentedData = useMemo(() => {
    if (data === undefined) return undefined;
    return decorateWorkbookComparisonSide(
      withActiveScope(data, "sheet", activeSheetId),
      side,
      items,
    );
  }, [activeSheetId, data, items, side]);
  const installCanvasHighlights = useCallback<
    NonNullable<
      import("../editor/collaboration-editor").CollaborationEditorProps["onLocalUnitMounted"]
    >
  >(
    ({ univer, unitId, unitType }) => {
      const controller = createNativeComparisonHighlightController({
        univer,
        unitId,
        unitType,
        side,
        items: presentationItems,
      });
      void controller.refresh();
      const workbookModel = univer
        .__getInjector()
        .get(IUniverInstanceService)
        .getUnit<Workbook>(unitId, UniverInstanceType.UNIVER_SHEET);
      const workbook =
        workbookModel === null || workbookModel === undefined
          ? null
          : univer.__getInjector().createInstance(FWorkbook, workbookModel);
      let selectedHighlight: IDisposable | null = null;
      return {
        dispose: () => {
          selectedHighlight?.dispose();
          controller.dispose();
        },
        setSelectedItem: (itemId) => controller.setSelectedItem(itemId),
        setSheetSelection: (selection) => {
          selectedHighlight?.dispose();
          selectedHighlight = null;
          if (workbook === null || selection === undefined) return;
          const sheet = workbook.getSheetBySheetId(selection.sheetId);
          if (sheet === null) return;
          const range = sheet.getRange(
            selection.startRow,
            selection.startColumn,
            selection.endRow - selection.startRow + 1,
            selection.endColumn - selection.startColumn + 1
          );
          sheet.activate();
          sheet.setActiveSelection(range);
          selectedHighlight = sheet.highlightRanges([range], {
            fill: selectedSheetFill(selection.kind),
            stroke: selectedSheetStroke(selection.kind),
            strokeWidth: 3,
            widgetSize: 0,
          });
        },
      };
    },
    [presentationItems, side]
  );
  return (
    <section className="grid min-h-[360px] min-w-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] bg-card max-[1023px]:min-h-0">
      <header className="grid h-14 grid-cols-[minmax(124px,220px)_minmax(0,1fr)] items-center gap-3 border-b border-border bg-card px-3.5">
        {sourceControl ?? <ComparisonRefLabel label={label} revision={revision} side={side} />}
        <div className="flex min-w-0 items-center justify-end gap-2">
          <ReadOnlyPill />
          <p className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-right text-[12px] leading-tight text-muted-foreground">
            {selectedText || t("comparisonSelectItemHint")}
          </p>
        </div>
      </header>
      <ComparisonPageTabs
        activeId={activeSheetId}
        ariaLabel={t("comparisonWorksheet")}
        options={sheetOptions}
        onSelect={onSelectSheet}
      />
      <WorkbookFxStrip item={item} showFormulaText={showFormulaText} side={side} />
      <div className="min-h-0 overflow-hidden">
        {presentedData === undefined ? (
          <div className="grid h-full content-center px-6 text-center text-sm text-muted-foreground">
            {t("comparisonSnapshotUnavailable")}
          </div>
        ) : (
          <ResourceEditor
            key={`${side}:${revision ?? 0}:${activeSheetId ?? "default"}`}
            comparisonViewer
            instanceKey={`comparison-${side}-${activeSheetId ?? "default"}`}
            localSelectedItemId={item?.id}
            localSheetSelection={sheetSelection}
            materializedData={presentedData}
            onLocalUnitMounted={installCanvasHighlights}
            readOnly
            unitId={unit.unitId}
            unitType={unit.unitType}
            user={user}
          />
        )}
      </div>
    </section>
  );
}

function NativeComparisonView({
  comparison,
  diff,
  sourceControl,
  unit,
  user,
}: ComparisonViewProps): ReactElement {
  const { language, t } = useI18n();
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const pageTabs = useMemo(
    () => comparisonPageOptions(diff.scopes, unit.unitType),
    [diff.scopes, unit.unitType]
  );
  const [activePageId, setActivePageId] = useState<string | null>(
    () => pageTabs[0]?.id ?? null
  );
  const selectedPageId = pageTabs.some((page) => page.id === activePageId)
    ? activePageId
    : pageTabs[0]?.id ?? null;
  const items = useMemo(
    () => filterItemsByScope(diff.items, selectedPageId),
    [diff.items, selectedPageId]
  );
  const selectedItem = items.find((item) => item.id === selectedItemId);
  const presentationItems = useMemo(
    () => structuralDiffItemsFromResult(items),
    [items]
  );
  const paragraphAlignment =
    diff.productContext !== undefined &&
    "paragraphAlignment" in diff.productContext
      ? diff.productContext.paragraphAlignment
      : [];
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedItemId(undefined);
    setActivePageId(pageTabs[0]?.id ?? null);
  }, [diff.comparisonId]);

  useEffect(
    () => attachLinkedWheelNavigation(leftRef.current, rightRef.current),
    [comparison.left.data, comparison.right.data, selectedPageId]
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-2">
      <div className="grid h-full min-h-[420px] grid-cols-[240px_minmax(720px,1fr)] overflow-hidden rounded-xl border border-border bg-border shadow-[0_12px_32px_rgb(15_23_42/0.08),0_1px_2px_rgb(15_23_42/0.06)] max-[1023px]:grid-cols-1 max-[1023px]:grid-rows-1">
        <NativeDiffSidebar
          fidelity={comparison.fidelity}
          items={items}
          language={language}
          selectedItemId={selectedItem?.id}
          onClear={() => setSelectedItemId(undefined)}
          onSelect={(item) => setSelectedItemId(item.id)}
        />
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)] bg-card">
          <div className="grid min-h-0 grid-cols-2 gap-px bg-border max-[1023px]:h-full max-[1023px]:grid-cols-1 max-[1023px]:grid-rows-2" data-testid="native-diff-panes">
            <NativeDiffSide
              activePageId={selectedPageId}
              alignment={paragraphAlignment}
              data={comparison.left.data}
              items={presentationItems}
              hostRef={leftRef}
              itemCount={items.length}
              label={t("officialVersion")}
              pageTabs={pageTabs}
              present={comparison.left.present}
              revision={comparison.left.revision}
              side="left"
              peerData={comparison.right.data}
              selectedItemId={selectedItem?.id}
              sourceControl={sourceControl}
              unit={unit}
              user={user}
              onSelectPage={setActivePageId}
            />
            <NativeDiffSide
              activePageId={selectedPageId}
              alignment={paragraphAlignment}
              data={comparison.right.data}
              items={presentationItems}
              hostRef={rightRef}
              itemCount={items.length}
              label={t("agentVersion")}
              pageTabs={pageTabs}
              present={comparison.right.present}
              revision={comparison.right.revision}
              side="right"
              peerData={comparison.left.data}
              selectedItemId={selectedItem?.id}
              sourceControl={undefined}
              unit={unit}
              user={user}
              onSelectPage={setActivePageId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function NativeDiffSidebar({
  items,
  fidelity,
  language,
  selectedItemId,
  onClear,
  onSelect,
}: {
  readonly items: readonly IUnitComparisonItem[];
  readonly fidelity: Comparison["fidelity"];
  readonly language: AppLanguage;
  readonly selectedItemId: string | undefined;
  readonly onClear: () => void;
  readonly onSelect: (item: IUnitComparisonItem) => void;
}): ReactElement {
  const { t } = useI18n();
  return (
    <aside
      className="min-h-0 overflow-auto border-r bg-card p-3 max-[1023px]:hidden"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClear();
      }}
    >
      <div className="mb-3 flex items-center justify-between border-b border-border pb-3 text-xs font-semibold">
        <div className="grid gap-0.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {t("comparisonChanges")}
          </span>
          <span className="text-[13px] text-foreground">{t("comparisonStructuralDiff")}</span>
        </div>
        <Badge>{items.length}</Badge>
      </div>
      {fidelity === "snapshot" ? (
        <div className="mb-2 rounded-md border border-warning/35 bg-warning-muted p-2 text-[11px] leading-4 text-warning">
          {t("comparisonSnapshot")}
        </div>
      ) : null}
      {items.length === 0 ? (
        <div className="px-1 py-3 text-xs text-muted-foreground">{t("comparisonNoChanges")}</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <DiffItemButton
              item={item}
              key={item.id}
              language={language}
              selected={selectedItemId === item.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function NativeDiffSide({
  activePageId,
  alignment,
  data,
  items,
  hostRef,
  itemCount,
  label,
  pageTabs,
  present,
  revision,
  side,
  peerData,
  selectedItemId,
  sourceControl,
  unit,
  user,
  onSelectPage,
}: {
  readonly activePageId: string | null;
  readonly alignment: readonly DocumentParagraphAlignment[];
  readonly data: Record<string, unknown> | undefined;
  readonly items: readonly StructuralDiffItem[];
  readonly hostRef: React.RefObject<HTMLDivElement | null>;
  readonly itemCount: number;
  readonly label: string;
  readonly pageTabs: readonly PageOption[];
  readonly present: boolean;
  readonly revision: number | undefined;
  readonly side: "left" | "right";
  readonly peerData: Record<string, unknown> | undefined;
  readonly selectedItemId: string | undefined;
  readonly sourceControl: ReactNode | undefined;
  readonly unit: WorktreeUnit;
  readonly user: ComparisonViewProps["user"];
  readonly onSelectPage: (id: string) => void;
}): ReactElement {
  const { t } = useI18n();
  const installCanvasHighlights = useCallback<
    NonNullable<
      import("../editor/collaboration-editor").CollaborationEditorProps["onLocalUnitMounted"]
    >
  >(
    ({ containerId, univer, univerAPI, unitId, unitType }) => {
      const controller = createNativeComparisonHighlightController({
        univer,
        unitId,
        unitType,
        side,
        items,
      });
      void controller.refresh();
      const injector = univer.__getInjector();
      const documentModel =
        unitType === UniverInstanceType.UNIVER_DOC
          ? injector
              .get(IUniverInstanceService)
              .getUnit<DocumentDataModel>(unitId, UniverInstanceType.UNIVER_DOC)
          : null;
      const slideDrawingStateService =
        unitType === UniverInstanceType.UNIVER_SLIDE
          ? injector.get(ISlideDrawingStateService)
          : undefined;
      const decorateDocument = (itemId: string | undefined): IDocumentData | undefined => {
        if (
          unit.unitType !== "doc" ||
          data === undefined ||
          peerData === undefined
        ) {
          return undefined;
        }
        const source = withActiveScope(
          data,
          unit.unitType,
          activePageId
        ) as unknown as IDocumentData;
        return decorateDocumentComparisonSide(
          source,
          peerData as unknown as IDocumentData,
          side,
          {
            items,
            alignment,
            ...(itemId === undefined ? {} : { selectedItemId: itemId }),
          }
        );
      };
      return {
        dispose: () => controller.dispose(),
        setSelectedItem: async (itemId) => {
          const decorated = decorateDocument(itemId);
          if (documentModel != null && decorated !== undefined) {
            documentModel.reset(decorated);
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve())
            );
          }
          await controller.setSelectedItem(itemId);
          const selectedItem = items.find((candidate) => candidate.id === itemId);
          if (selectedItem === undefined) return;
          const focused = await focusPreviewComparisonTarget(
            univerAPI,
            unitType,
            containerId,
            structuralDiffFocusTarget(selectedItem, side),
            {
              selectSlideElement: (slideId, elementId) =>
                slideDrawingStateService?.selectDrawings(
                  { unitId, subUnitId: slideId },
                  [elementId],
                  elementId
                ),
            }
          );
          if (focused) await controller.refresh();
        },
      };
    },
    [activePageId, alignment, data, items, peerData, side, unit.unitType]
  );
  const presentedData = useMemo(() => {
    const scoped =
      data === undefined
        ? undefined
        : withActiveScope(data, unit.unitType, activePageId);
    if (
      scoped === undefined ||
      peerData === undefined ||
      unit.unitType !== "doc"
    ) {
      return scoped;
    }
    return decorateDocumentComparisonSide(
      scoped as unknown as IDocumentData,
      peerData as unknown as IDocumentData,
      side,
      {
        items,
        alignment,
      }
    ) as unknown as Record<string, unknown>;
  }, [activePageId, alignment, data, items, peerData, side, unit.unitType]);
  return (
    <section className={cn("grid min-h-0 bg-background", pageTabs.length > 0 ? "grid-rows-[56px_auto_minmax(0,1fr)]" : "grid-rows-[56px_minmax(0,1fr)]")}>
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
        {sourceControl ?? <ComparisonRefLabel label={label} revision={revision} side={side} />}
        <div className="flex shrink-0 items-center gap-2">
          <ReadOnlyPill />
          <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
            {t("comparisonDifferenceCount", { count: itemCount })}
          </span>
        </div>
      </header>
      {pageTabs.length > 0 ? (
        <ComparisonPageTabs activeId={activePageId} ariaLabel={t("comparisonChangedSlides")} options={pageTabs} onSelect={onSelectPage} />
      ) : null}
      <div ref={hostRef} className="relative min-h-0 overflow-hidden">
        {present && presentedData !== undefined ? (
          <ResourceEditor
            key={`${side}:${revision ?? 0}:${activePageId ?? "default"}`}
            comparisonViewer
            instanceKey={`comparison-${side}-${activePageId ?? "default"}`}
            localSelectedItemId={selectedItemId}
            materializedData={presentedData}
            onLocalUnitMounted={installCanvasHighlights}
            readOnly
            unitId={unit.unitId}
            unitType={unit.unitType}
            user={user}
          />
        ) : (
          <div className={cn("absolute inset-0 z-20 grid place-items-center px-6 text-center text-sm font-medium backdrop-blur-sm", side === "left" ? "bg-diff-delete-muted/95 text-diff-delete" : "bg-diff-insert-muted/95 text-diff-insert")}>
            {t("comparisonNotPresent")}
          </div>
        )}
      </div>
    </section>
  );
}

function DiffItemButton({
  item,
  language,
  selected,
  onSelect,
}: {
  readonly item: IUnitComparisonItem;
  readonly language: AppLanguage;
  readonly selected: boolean;
  readonly onSelect: (item: IUnitComparisonItem) => void;
}): ReactElement {
  const { t } = useI18n();
  const label = comparisonItemLabel(item, language);
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "block w-full rounded-lg border px-2.5 py-2 text-left text-[11px] leading-4 outline-none transition-[border-color,background,box-shadow,transform] hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring",
        item.kind === "insert"
          ? "border-diff-insert/35 bg-diff-insert-muted text-diff-insert"
          : item.kind === "delete"
            ? "border-diff-delete/35 bg-diff-delete-muted text-diff-delete"
            : "border-diff-update/35 bg-diff-update-muted text-diff-update",
        selected && "ring-2 ring-ring ring-offset-1 ring-offset-background"
      )}
      data-diff-sidebar-selected={selected ? "true" : undefined}
      title={label}
      type="button"
      onClick={() => onSelect(item)}
    >
      <div className="truncate font-medium">{label}</div>
      <div className="truncate opacity-70">
        {comparisonEntityLabel(item.entityType, language)} · {t(kindKey(item.kind))}
        {item.changes.length > 0
          ? ` · ${t("comparisonDifferenceCount", { count: item.changes.length })}`
          : ""}
      </div>
    </button>
  );
}

function ComparisonSourceControl({
  label,
  revision,
  refreshing,
  onRefresh,
}: {
  readonly label: string;
  readonly revision: number | undefined;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}): ReactElement {
  const { t } = useI18n();
  return (
    <button
      className="group flex min-w-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={t("refreshComparison")}
      type="button"
      onClick={onRefresh}
    >
      <div className="grid min-w-0 gap-0.5">
        <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
          {t("comparisonLeftSource")}
        </span>
        <span className="truncate text-[12px] font-semibold text-foreground">
          {label}{revision === undefined ? "" : ` · r${revision}`}
        </span>
      </div>
      <RefreshCw
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
          refreshing && "animate-spin opacity-100"
        )}
      />
    </button>
  );
}

function ComparisonRefLabel({
  label,
  revision,
  side,
}: {
  readonly label: string;
  readonly revision: number | undefined;
  readonly side: "left" | "right";
}): ReactElement {
  const { t } = useI18n();
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
        {side === "left" ? t("comparisonLeftSource") : t("comparisonRightCurrentVersion")}
      </span>
      <span className="truncate text-[12px] font-semibold text-foreground" title={label}>
        {label}{revision === undefined ? "" : ` · r${revision}`}
      </span>
    </div>
  );
}

function ReadOnlyPill(): ReactElement {
  const { t } = useI18n();
  return (
    <span className="shrink-0 rounded-full border border-border bg-muted/55 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      {t("comparisonReadOnly")}
    </span>
  );
}

function ComparisonPageTabs({
  activeId,
  ariaLabel,
  options,
  onSelect,
}: {
  readonly activeId: string | null;
  readonly ariaLabel: string;
  readonly options: readonly PageOption[];
  readonly onSelect: (id: string) => void;
}): ReactElement {
  if (options.length === 0) return <div className="hidden" />;
  return (
    <div className="grid min-h-10 min-w-0 items-end border-b border-border bg-muted/45 px-2 pt-1.5">
      <div className="flex min-w-0 items-end gap-0.5 overflow-x-auto" role="tablist" aria-label={ariaLabel}>
        {options.map((option) => {
          const active = activeId === option.id;
          return (
            <button
              aria-selected={active}
              className={cn(
                "relative -mb-px h-8 min-w-[76px] max-w-[184px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-t-[6px] rounded-b-none border border-b-0 border-border bg-muted/70 px-3 text-left text-[11px] font-semibold leading-none text-muted-foreground outline-none transition-[background,border-color,color,box-shadow]",
                "hover:bg-card/80 hover:text-foreground focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/25",
                option.status === "insert" && "border-diff-insert/45 text-diff-insert",
                option.status === "delete" && "border-diff-delete/45 text-diff-delete",
                option.status === "update" && "border-diff-update/45 text-diff-update",
                active && "z-[1] h-[33px] border-border bg-card text-foreground shadow-[inset_0_2px_0_var(--comparison-tab-accent)]",
                active && option.status === "insert" && "[--comparison-tab-accent:var(--color-diff-insert)]",
                active && option.status === "delete" && "[--comparison-tab-accent:var(--color-diff-delete)]",
                active && option.status === "update" && "[--comparison-tab-accent:var(--color-diff-update)]"
              )}
              key={option.id}
              role="tab"
              type="button"
              onClick={() => onSelect(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkbookFxStrip({
  item,
  showFormulaText,
  side,
}: {
  readonly item: IUnitComparisonItem | null;
  readonly showFormulaText: boolean;
  readonly side: "left" | "right";
}): ReactElement {
  const change = preferredLeafChange(item?.changes ?? [], showFormulaText);
  const address = item?.path.at(-1) ?? "--";
  return (
    <div className="border-b border-border bg-[color-mix(in_srgb,var(--color-muted)_16%,var(--color-card))] px-3 py-2">
      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-center font-mono text-[11px] font-medium text-foreground shadow-xs">
          {address}
        </div>
        <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 shadow-xs">
          <div className="flex min-h-10 max-h-20 items-center overflow-y-auto py-0 pr-1 text-left font-mono text-[11px] leading-snug text-foreground">
            <span className="block min-w-0 whitespace-pre-wrap break-all">
              <DiffValue change={change} side={side} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffValue({
  change,
  side,
}: {
  readonly change: IUnitComparisonLeafChange | undefined;
  readonly side: "left" | "right";
}): ReactElement {
  const segments = change?.segments?.[side];
  if (segments?.length) {
    return (
      <>
        {segments.map((segment, index) => (
          <span
            className={cn(
              segment.kind === "delete" && "rounded-sm bg-diff-delete-muted text-diff-delete line-through decoration-diff-delete/80",
              segment.kind === "insert" && "rounded-sm bg-diff-insert-muted text-diff-insert"
            )}
            key={`${segment.kind}:${index}:${segment.text}`}
          >
            {segment.text}
          </span>
        ))}
      </>
    );
  }
  const value = side === "left" ? change?.before : change?.after;
  return <>{value === undefined ? "—" : formatValue(value)}</>;
}

function DiffSummaryPills({ counts }: { readonly counts: Readonly<Record<DiffKind, number>> }): ReactElement {
  return (
    <div className="flex items-center gap-1 text-[10px] font-semibold tabular-nums">
      {counts.insert > 0 ? <span className="rounded-full bg-diff-insert-muted px-2 py-0.5 text-diff-insert">+{counts.insert}</span> : null}
      {counts.delete > 0 ? <span className="rounded-full bg-diff-delete-muted px-2 py-0.5 text-diff-delete">−{counts.delete}</span> : null}
      {counts.update > 0 ? <span className="rounded-full bg-diff-update-muted px-2 py-0.5 text-diff-update">~{counts.update}</span> : null}
    </div>
  );
}

function CompactSegmentedControl({
  fullWidth = false,
  options,
  value,
  onChange,
}: {
  readonly fullWidth?: boolean;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}): ReactElement {
  return (
    <div
      className={cn("grid h-9 rounded-lg bg-muted p-1", fullWidth && "w-full")}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={cn(
            "rounded-md px-3 text-[11px] font-semibold text-muted-foreground outline-none transition-[background,color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
            value === option.value && "bg-card text-foreground shadow-xs"
          )}
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function comparisonSheetOptions(
  diff: IUnitComparisonResult,
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
): PageOption[] {
  const context = diff.productContext;
  if (context && "sheets" in context) {
    return context.sheets.map((sheet) => ({
      id: sheet.sheetId,
      label: sheet.name,
      status: scopeKind(diff.scopes, sheet.sheetId),
    }));
  }
  const sheetScopes = diff.scopes.filter((scope) => scope.entityType === "worksheet");
  if (sheetScopes.length > 0) return sheetScopes.map(scopeOption);
  return workbookSheetOptions(right ?? left);
}

function selectedSheetFill(kind: DiffKind): string {
  return kind === "delete"
    ? "rgba(239,68,68,0.40)"
    : kind === "insert"
      ? "rgba(34,197,94,0.40)"
      : "rgba(59,130,246,0.36)";
}

function selectedSheetStroke(kind: DiffKind): string {
  return kind === "delete"
    ? "rgba(220,38,38,0.86)"
    : kind === "insert"
      ? "rgba(22,163,74,0.86)"
      : "rgba(37,99,235,0.86)";
}

function workbookSheetOptions(data: Record<string, unknown> | undefined): PageOption[] {
  if (!data) return [];
  const sheets = asRecord(data.sheets);
  const order = Array.isArray(data.sheetOrder)
    ? data.sheetOrder.filter((id): id is string => typeof id === "string")
    : Object.keys(sheets ?? {});
  return order.map((id) => {
    const sheet = asRecord(sheets?.[id]);
    return {
      id,
      label: typeof sheet?.name === "string" ? sheet.name : id,
      status: "update",
    };
  });
}

function comparisonPageOptions(
  scopes: readonly IUnitComparisonScope[],
  unitType: UnitType
): PageOption[] {
  if (unitType !== "slide") return [];
  return scopes.filter((scope) => scope.entityType === "slide").map(scopeOption);
}

function scopeOption(scope: IUnitComparisonScope): PageOption {
  return { id: scope.stableId, label: scope.displayName, status: scope.kind };
}

function scopeKind(scopes: readonly IUnitComparisonScope[], id: string): DiffKind {
  return scopes.find((scope) => scope.stableId === id)?.kind ?? "update";
}

function filterItemsByScope(
  items: readonly IUnitComparisonItem[],
  scopeId: string | null
): readonly IUnitComparisonItem[] {
  if (scopeId === null) return items;
  return items.filter(
    (item) =>
      item.scope?.stableId === scopeId ||
      item.parentStableId === scopeId ||
      item.stableId === scopeId
  );
}

export function filterWorkbookItems(
  items: readonly IUnitComparisonItem[],
  input: {
    readonly displayMode: DisplayMode;
    readonly query: string;
    readonly sheetId: string | null;
    readonly tab: SidebarTab;
  }
): readonly IUnitComparisonItem[] {
  const query = input.query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    const workbookItem = item.entityType === "workbook";
    if ((input.tab === "workbook") !== workbookItem) return false;
    if (input.sheetId !== null && filterItemsByScope([item], input.sheetId).length === 0) {
      return false;
    }
    const styleOnly =
      item.changes.length > 0 &&
      item.changes.every((change) => STYLE_VALUE_TYPES.has(change.valueType));
    if (input.displayMode === "style" ? !styleOnly : styleOnly) return false;
    if (!query) return true;
    return [
      item.displayName,
      item.stableId,
      item.entityType,
      ...item.path,
      ...item.changes.flatMap((change) => [
        change.path.join("."),
        formatValue(change.before),
        formatValue(change.after),
      ]),
    ]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLocaleLowerCase().includes(query));
  });
}

function preferredLeafChange(
  changes: readonly IUnitComparisonLeafChange[],
  showFormulaText: boolean
): IUnitComparisonLeafChange | undefined {
  if (showFormulaText) {
    return changes.find((change) => change.valueType === "formula") ?? changes[0];
  }
  return changes.find((change) => change.valueType !== "style") ?? changes[0];
}

export function comparisonItemLabel(
  item: IUnitComparisonItem,
  language: AppLanguage
): string {
  const entity = comparisonEntityLabel(item.entityType, language);
  const candidate = item.displayName?.trim();
  const pathLabel = item.path.at(-1);
  const label =
    candidate && candidate !== item.stableId
      ? candidate
      : pathLabel && !looksLikeOpaqueId(pathLabel)
        ? `${entity} · ${pathLabel}`
        : entity;
  if (!item.moved) return label;
  return `${label} · ${language === "zh-CN" ? "已移动" : "Moved"}`;
}

function looksLikeOpaqueId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(value) || value.length > 80;
}

function comparisonEntityLabel(entityType: string, language: AppLanguage): string {
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    workbook: ["工作簿", "Workbook"],
    worksheet: ["工作表", "Worksheet"],
    cell: ["单元格", "Cell"],
    "row-column": ["行列", "Row or column"],
    paragraph: ["段落", "Paragraph"],
    "text-style": ["文本样式", "Text style"],
    section: ["分节", "Section"],
    table: ["表格", "Table"],
    shape: ["形状", "Shape"],
    chart: ["图表", "Chart"],
    slide: ["幻灯片", "Slide"],
    "slide-element": ["幻灯片元素", "Slide element"],
    base: ["多维表格", "Base"],
    field: ["字段", "Field"],
    record: ["记录", "Record"],
    view: ["视图", "View"],
    "board-page": ["画板页面", "Board page"],
    "board-element": ["画板元素", "Board element"],
  };
  const label = labels[entityType];
  if (!label) return entityType.replaceAll("-", " ");
  return language === "zh-CN" ? label[0] : label[1];
}

function kindKey(kind: DiffKind): MessageKey {
  return kind === "insert"
    ? "comparisonKindInsert"
    : kind === "delete"
      ? "comparisonKindDelete"
      : "comparisonKindUpdate";
}

function withActiveScope(
  data: Record<string, unknown>,
  unitType: UnitType,
  activeId: string | null
): Record<string, unknown> {
  if (activeId === null) return data;
  if (unitType === "sheet") return { ...data, activeSheetId: activeId };
  if (unitType === "slide") return { ...data, activeSlideId: activeId };
  if (unitType === "board") return { ...data, activePageId: activeId };
  return data;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > 120 ? `${encoded.slice(0, 117)}…` : encoded;
  } catch {
    return String(value);
  }
}

/** Copy direct wheel gestures across native canvas panes, matching univer-cli navigation. */
function attachLinkedWheelNavigation(
  left: HTMLDivElement | null,
  right: HTMLDivElement | null
): () => void {
  if (left === null || right === null) return () => undefined;
  const linkedEvents = new WeakSet<Event>();
  const attach = (source: HTMLElement, target: HTMLElement): (() => void) => {
    const listener = (event: WheelEvent): void => {
      if (linkedEvents.has(event)) return;
      const targetNode = target.querySelector("canvas") ?? target;
      const bounds = targetNode.getBoundingClientRect();
      const linked = new WheelEvent("wheel", {
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        bubbles: true,
        cancelable: true,
      });
      linkedEvents.add(linked);
      targetNode.dispatchEvent(linked);
    };
    source.addEventListener("wheel", listener, { capture: true, passive: true });
    return () => source.removeEventListener("wheel", listener, { capture: true });
  };
  const disposeLeft = attach(left, right);
  const disposeRight = attach(right, left);
  return () => {
    disposeLeft();
    disposeRight();
  };
}
