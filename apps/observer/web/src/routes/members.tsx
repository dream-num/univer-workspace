import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  type ObservationMember,
  ObservationCard,
  ObservationShell,
  observationRequest,
} from "../features/observation";
import { PageHeading } from "./index";

export const Route = createFileRoute("/members")({
  component: ObservationMembersPage,
});

interface AccessEvent {
  readonly id: string;
  readonly actorGithubUserId: string | null;
  readonly actorGithubLogin: string | null;
  readonly targetGithubUserId: string | null;
  readonly targetGithubLogin: string | null;
  readonly action: "setup" | "add" | "remove";
  readonly result: "succeeded" | "rejected";
  readonly createdAt: number;
}

function ObservationMembersPage() {
  const queryClient = useQueryClient();
  const [login, setLogin] = useState("");
  const members = useQuery({
    queryKey: ["observation", "members"],
    queryFn: () => observationRequest<{ readonly members: readonly ObservationMember[] }>("/api/members"),
  });
  const events = useQuery({
    queryKey: ["observation", "access-events"],
    queryFn: () => observationRequest<{ readonly events: readonly AccessEvent[] }>("/api/access-events?limit=200"),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["observation", "members"] }),
      queryClient.invalidateQueries({ queryKey: ["observation", "access-events"] }),
      queryClient.invalidateQueries({ queryKey: ["observation", "status"] }),
    ]);
  };
  const add = useMutation({
    mutationFn: () => observationRequest("/api/members", { method: "POST", body: JSON.stringify({ githubLogin: login }) }),
    onSuccess: async () => { setLogin(""); await refresh(); },
  });
  const remove = useMutation({
    mutationFn: (githubUserId: string) => observationRequest<void>(`/api/members/${encodeURIComponent(githubUserId)}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return (
    <ObservationShell>
      <PageHeading title="成员与访问历史" description="所有 Observation Member 权限相同；移除成员会立即撤销其全部 Session。" />
      <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <ObservationCard title="Observation Members">
          {members.data?.members.map((member) => <div key={member.githubUserId} className="flex items-center gap-3 border-b border-white/5 py-3 last:border-0">
            {member.avatarUrl ? <img src={member.avatarUrl} alt="" className="h-9 w-9 rounded-full" /> : <div className="h-9 w-9 rounded-full bg-white/10" />}
            <div className="min-w-0 flex-1"><div className="truncate text-sm text-slate-200">{member.displayName}</div><div className="truncate text-xs text-slate-500">@{member.githubLogin} · GitHub ID {member.githubUserId}</div></div>
            <div className="text-right text-xs text-slate-600"><div>加入于</div><time>{new Date(member.createdAt).toLocaleString()}</time></div>
            <button type="button" disabled={remove.isPending} onClick={() => {
              if (window.confirm(`确认移除 @${member.githubLogin}？该用户的所有 Observation Session 将被撤销。`)) remove.mutate(member.githubUserId);
            }} className="rounded-md border border-red-400/20 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50">移除</button>
          </div>)}
          {members.isLoading ? <p className="text-sm text-slate-500">加载中…</p> : null}
          {members.isError ? <p className="text-sm text-red-300">{members.error.message}</p> : null}
          {remove.isError ? <p className="mt-3 text-sm text-red-300">{remove.error.message}</p> : null}
        </ObservationCard>
        <ObservationCard title="添加 Member">
          <p className="mb-4 text-sm leading-6 text-slate-400">输入 GitHub Login 或 github.com 个人主页。服务端会解析并保存稳定的 Numeric User ID。</p>
          <input value={login} onChange={(event) => setLogin(event.target.value)} placeholder="octocat 或 https://github.com/octocat" className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          <button type="button" disabled={!login.trim() || add.isPending} onClick={() => add.mutate()} className="mt-3 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50">{add.isPending ? "正在解析 GitHub 身份…" : "添加 Member"}</button>
          {add.isError ? <p className="mt-3 text-sm text-red-300">{add.error.message}</p> : null}
        </ObservationCard>
      </div>

      <ObservationCard title="不可修改的访问历史" className="mt-5">
        {events.data?.events.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="pb-3 font-medium">时间</th><th className="pb-3 font-medium">操作者</th><th className="pb-3 font-medium">动作</th><th className="pb-3 font-medium">目标</th><th className="pb-3 font-medium">结果</th></tr></thead><tbody>{events.data.events.map((event) => <tr key={event.id} className="border-t border-white/5"><td className="py-3 text-slate-500">{new Date(event.createdAt).toLocaleString()}</td><td className="py-3 text-slate-400">{event.actorGithubLogin ? `@${event.actorGithubLogin}` : "—"}</td><td className="py-3 text-slate-300">{event.action === "setup" ? "初始化" : event.action === "add" ? "添加" : "移除"}</td><td className="py-3 text-slate-400">{event.targetGithubLogin ? `@${event.targetGithubLogin}` : event.targetGithubUserId ?? "—"}</td><td className={event.result === "succeeded" ? "py-3 text-emerald-400" : "py-3 text-amber-300"}>{event.result === "succeeded" ? "成功" : "拒绝"}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-500">暂无记录。</p>}
        {events.isError ? <p className="text-sm text-red-300">{events.error.message}</p> : null}
      </ObservationCard>
    </ObservationShell>
  );
}
