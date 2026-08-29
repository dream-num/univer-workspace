import { useQueries } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Metric,
  ObservationCard,
  ObservationShell,
  observationRequest,
} from "../features/observation";

export const Route = createFileRoute("/")({
  component: ObservationOverviewPage,
});

interface Overview {
  readonly observerVersion: string;
  readonly workspaceVersion: string | null;
  readonly startedAt: number;
  readonly uptimeMs: number;
  readonly databaseBytes: { readonly product: number | null; readonly collaboration: number | null; readonly observer: number | null };
  readonly counts: { readonly users: number; readonly spaces: number; readonly resources: number; readonly worktrees: number; readonly nodes: number };
}
interface Operations {
  readonly executing: number;
  readonly waiting: number;
  readonly dueBacklog: number;
  readonly failed: number;
  readonly errors: readonly { readonly kind: string; readonly errorCode: string; readonly count: number }[];
}
interface Storage {
  readonly blobCount: number;
  readonly blobBytes: number;
  readonly quarantinedCount: number;
  readonly activeUploadCount: number;
  readonly pendingDeletionCount: number;
  readonly univerAssetCount: number;
  readonly univerAssetBytes: number;
}

function ObservationOverviewPage() {
  const [overview, operations, storage, config] = useQueries({ queries: [
    { queryKey: ["observation", "overview"], queryFn: () => observationRequest<Overview>("/api/overview"), refetchInterval: 30_000 },
    { queryKey: ["observation", "operations"], queryFn: () => observationRequest<Operations>("/api/operations"), refetchInterval: 30_000 },
    { queryKey: ["observation", "storage"], queryFn: () => observationRequest<Storage>("/api/storage"), refetchInterval: 30_000 },
    { queryKey: ["observation", "config"], queryFn: () => observationRequest<Record<string, unknown>>("/api/config") },
  ] });

  return (
    <ObservationShell>
      <PageHeading title="部署总览" description="产品、任务和持久化状态的只读快照。默认每 30 秒刷新。" />
      {overview.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ObservationCard><Metric label="Observer 版本" value={overview.data.observerVersion} hint={`启动于 ${formatDate(overview.data.startedAt)}`} /></ObservationCard>
          <ObservationCard><Metric label="用户 / 空间" value={`${overview.data.counts.users} / ${overview.data.counts.spaces}`} hint={overview.data.workspaceVersion ? `Workspace ${overview.data.workspaceVersion}` : "Workspace 版本未配置"} /></ObservationCard>
          <ObservationCard><Metric label="资源 / 节点" value={`${overview.data.counts.resources} / ${overview.data.counts.nodes}`} /></ObservationCard>
          <ObservationCard><Metric label="Worktree" value={overview.data.counts.worktrees} /></ObservationCard>
        </div>
      ) : <Loading query={overview} />}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <ObservationCard title="Operations">
          {operations.data ? <>
            <div className="grid grid-cols-4 gap-4">
              <Metric label="执行中" value={operations.data.executing} />
              <Metric label="等待中" value={operations.data.waiting} />
              <Metric label="到期积压" value={operations.data.dueBacklog} />
              <Metric label="失败" value={operations.data.failed} />
            </div>
            <SimpleTable rows={operations.data.errors.map((row) => [row.kind, row.errorCode, String(row.count)])} empty="暂无失败 Operation" />
          </> : <Loading query={operations} />}
        </ObservationCard>
        <ObservationCard title="Storage">
          {storage.data ? <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            <Metric label="Blob" value={storage.data.blobCount} hint={formatBytes(storage.data.blobBytes)} />
            <Metric label="Univer Assets" value={storage.data.univerAssetCount} hint={formatBytes(storage.data.univerAssetBytes)} />
            <Metric label="隔离对象" value={storage.data.quarantinedCount} />
            <Metric label="活跃上传" value={storage.data.activeUploadCount} />
            <Metric label="待删除" value={storage.data.pendingDeletionCount} />
          </div> : <Loading query={storage} />}
        </ObservationCard>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <ObservationCard title="Database 文件大小">
          {overview.data ? <div className="grid grid-cols-3 gap-5">
            <Metric label="Product" value={formatBytes(overview.data.databaseBytes.product)} />
            <Metric label="Collaboration" value={formatBytes(overview.data.databaseBytes.collaboration)} />
            <Metric label="Observer" value={formatBytes(overview.data.databaseBytes.observer)} />
          </div> : null}
        </ObservationCard>
        <ObservationCard title="脱敏配置">
          {config.data ? <pre className="max-h-64 overflow-auto text-xs leading-5 text-slate-400">{JSON.stringify(config.data, null, 2)}</pre> : <Loading query={config} />}
        </ObservationCard>
      </div>
    </ObservationShell>
  );
}

export function PageHeading({ title, description }: { readonly title: string; readonly description: string }) {
  return <div className="mb-7"><h1 className="text-2xl font-semibold text-white">{title}</h1><p className="mt-2 text-sm text-slate-400">{description}</p></div>;
}

function Loading({ query }: { readonly query: { readonly isError: boolean; readonly error: Error | null } }) {
  return <p className={query.isError ? "text-sm text-red-300" : "text-sm text-slate-500"}>{query.isError ? query.error?.message : "加载中…"}</p>;
}

function SimpleTable({ rows, empty }: { readonly rows: readonly (readonly string[])[]; readonly empty: string }) {
  if (rows.length === 0) return <p className="mt-5 text-sm text-slate-500">{empty}</p>;
  return <div className="mt-5 overflow-hidden rounded-lg border border-white/10">{rows.map((row, index) => <div key={`${row.join("-")}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-4 border-b border-white/5 px-3 py-2 text-xs last:border-0">{row.map((cell) => <span key={cell} className="truncate text-slate-400">{cell}</span>)}</div>)}</div>;
}

function formatBytes(value: number | null): string {
  if (value === null) return "不可用";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}

function formatDate(value: number): string { return new Date(value).toLocaleString(); }
