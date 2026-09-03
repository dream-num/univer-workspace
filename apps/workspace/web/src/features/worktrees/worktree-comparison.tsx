import { useQuery } from "@tanstack/react-query";
import { GitCompareArrows, RefreshCw } from "lucide-react";
import type { components } from "../../../../generated/http/schema.js";
import { sessionQueryOptions } from "../auth";
import { ResourceEditor } from "../editor";
import { useI18n } from "../../shared/i18n";
import { Alert, Badge, Button, Empty, Spinner } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { worktreeUnitComparisonQueryOptions } from "./worktrees.queries";

type WorktreeUnit = components["schemas"]["WorktreeUnit"];
type Comparison = components["schemas"]["WorktreeUnitComparison"];

interface DiffSummary {
  readonly total?: number;
  readonly insert?: number;
  readonly delete?: number;
  readonly update?: number;
}

interface DiffItem {
  readonly id?: string;
  readonly kind?: "insert" | "delete" | "update";
  readonly entityType?: string;
  readonly displayName?: string;
  readonly path?: readonly string[];
  readonly changes?: readonly {
    readonly path?: readonly string[];
    readonly before?: unknown;
    readonly after?: unknown;
  }[];
}

interface ComparisonDiff {
  readonly summary?: DiffSummary;
  readonly items?: readonly DiffItem[];
  readonly page?: { readonly hasMore?: boolean };
}

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
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => void comparison.refetch()}
        >
          <RefreshCw />
          {t("refreshComparison")}
        </Button>
      </div>
    );
  }

  const value = comparison.data as Comparison;
  const diff = value.diff as ComparisonDiff;
  const items = diff.items ?? [];
  const total = diff.summary?.total ?? items.length;
  const user = session.data.user;

  return (
    <div className="flex min-h-[480px] flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-subtle/40 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <GitCompareArrows className="size-4 shrink-0" />
          <span>
            {t("comparisonCapturedAt", {
              value: formatCapturedAt(value.capturedAt),
            })}
          </span>
          <Badge variant="outline">
            {t("comparisonChangeCount", { count: total })}
          </Badge>
          <Badge variant="outline">{value.fidelity}</Badge>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void comparison.refetch()}
          disabled={comparison.isFetching}
        >
          <RefreshCw className={cn(comparison.isFetching && "animate-spin")} />
          {t("refreshComparison")}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 max-[1100px]:flex-col">
        <ComparisonChanges
          items={items}
          hasMore={diff.page?.hasMore === true}
        />
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-2 divide-x divide-border max-[800px]:grid-cols-1 max-[800px]:divide-x-0 max-[800px]:divide-y">
          <ComparisonSide
            label={t("officialVersion")}
            revision={value.left.revision}
            data={value.left.data}
            unit={unit}
            user={user}
            side="left"
          />
          <ComparisonSide
            label={t("agentVersion")}
            revision={value.right.revision}
            data={value.right.data}
            unit={unit}
            user={user}
            side="right"
          />
        </div>
      </div>
    </div>
  );
}

function ComparisonSide({
  label,
  revision,
  data,
  unit,
  user,
  side,
}: {
  readonly label: string;
  readonly revision?: number | undefined;
  readonly data?: Record<string, unknown> | undefined;
  readonly unit: WorktreeUnit;
  readonly user: {
    readonly id: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
  };
  readonly side: "left" | "right";
}) {
  const { t } = useI18n();
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 text-xs font-medium">
        <span>{label}</span>
        {revision === undefined ? null : (
          <span className="text-muted-foreground">r{revision}</span>
        )}
      </div>
      {data === undefined ? (
        <Empty
          className="m-auto"
          title={
            side === "left"
              ? t("comparisonNoOfficialVersion")
              : t("comparisonNoAgentVersion")
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ResourceEditor
            key={`${side}:${revision ?? 0}`}
            unitId={unit.unitId}
            unitType={unit.unitType}
            user={user}
            readOnly
            materializedData={data}
            instanceKey={`comparison-${side}`}
          />
        </div>
      )}
    </section>
  );
}

function ComparisonChanges({
  items,
  hasMore,
}: {
  readonly items: readonly DiffItem[];
  readonly hasMore: boolean;
}) {
  const { t } = useI18n();
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border max-[1100px]:h-44 max-[1100px]:w-full max-[1100px]:border-r-0 max-[1100px]:border-b">
      <div className="h-9 shrink-0 border-b border-border px-3 py-2 text-xs font-semibold">
        {t("comparisonChanges")}
      </div>
      {items.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          {t("comparisonNoChanges")}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {items.map((item, index) => (
            <div
              key={item.id ?? `${item.entityType ?? "change"}-${index}`}
              className="mb-1.5 rounded-md border border-border px-2.5 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    item.kind === "insert"
                      ? "bg-success"
                      : item.kind === "delete"
                        ? "bg-destructive"
                        : "bg-info"
                  )}
                />
                <span className="truncate font-medium">
                  {item.displayName ??
                    item.entityType ??
                    t("comparisonChange")}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {item.kind}
                </span>
              </div>
              {item.path?.length ? (
                <div className="mt-1 truncate text-muted-foreground">
                  {item.path.join(" / ")}
                </div>
              ) : null}
              {item.changes?.[0] ? (
                <div className="mt-1 truncate text-muted-foreground">
                  {item.changes[0].path?.join(".")}: {formatValue(
                    item.changes[0].before
                  )} → {formatValue(item.changes[0].after)}
                </div>
              ) : null}
            </div>
          ))}
          {hasMore ? (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {t("comparisonMoreChanges")}
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}

function formatCapturedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

function formatValue(value: unknown): string {
  if (value === undefined) return "∅";
  if (typeof value === "string") return value;
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > 80 ? `${encoded.slice(0, 77)}…` : encoded;
  } catch {
    return String(value);
  }
}
