import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import type { PropsWithChildren } from "react";
import { observationRequest, observationStatusQuery } from "./observation-api";

export function ObservationShell({ children }: PropsWithChildren) {
  const status = useQuery(observationStatusQuery);
  const navigate = useNavigate();

  if (status.isLoading) {
    return <main className="grid min-h-dvh place-items-center text-muted-foreground">正在检查 Observation Session…</main>;
  }
  if (!status.data?.authenticated || !status.data.member) {
    return (
      <Navigate
        to="/login"
        search={{ oauthError: undefined }}
        replace
      />
    );
  }

  const logout = async () => {
    await observationRequest<void>("/api/session", { method: "DELETE" });
    await navigate({
      to: "/login",
      search: { oauthError: undefined },
      replace: true,
    });
  };

  return (
    <div className="min-h-dvh bg-[#0b0f19] text-slate-100">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0b0f19]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-6 px-6 py-4">
          <Link to="/" className="font-semibold tracking-tight text-white">
            Univer Observation
          </Link>
          <nav className="flex items-center gap-1 text-sm text-slate-400">
            <ConsoleLink to="/">总览</ConsoleLink>
            <ConsoleLink to="/changesets">Changeset</ConsoleLink>
            <ConsoleLink to="/members">成员与历史</ConsoleLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-400">
            <span>@{status.data.member.githubLogin}</span>
            <button type="button" onClick={() => void logout()} className="rounded-md border border-white/10 px-3 py-1.5 hover:bg-white/5">
              退出
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-6 py-8">{children}</main>
    </div>
  );
}

function ConsoleLink({ to, children }: PropsWithChildren<{ readonly to: "/" | "/changesets" | "/members" }>) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="rounded-md px-3 py-2 hover:bg-white/5 hover:text-white"
      activeProps={{ className: "bg-white/10 text-white" }}
    >
      {children}
    </Link>
  );
}

export function ObservationCard({ title, children, className = "" }: PropsWithChildren<{ readonly title?: string; readonly className?: string }>) {
  return (
    <section className={`rounded-xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 ${className}`}>
      {title ? <h2 className="mb-4 text-sm font-medium text-slate-300">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Metric({ label, value, hint }: { readonly label: string; readonly value: string | number; readonly hint?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}
