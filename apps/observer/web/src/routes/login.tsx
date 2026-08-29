import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  observationRequest,
  observationStatusQuery,
} from "../features/observation";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    oauthError: typeof search.oauthError === "string" ? search.oauthError : undefined,
  }),
  component: ObservationLogin,
});

function ObservationLogin() {
  const { oauthError } = Route.useSearch();
  const status = useQuery(observationStatusQuery);
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status.data?.authenticated) void navigate({ to: "/", replace: true });
  }, [navigate, status.data?.authenticated]);

  const setup = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await observationRequest<{ readonly authorizationUrl: string }>(
        "/api/setup",
        { method: "POST", body: JSON.stringify({ token }) }
      );
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "初始化失败");
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-[#0b0f19] px-5 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.045] p-7 shadow-2xl shadow-black/30">
        <div className="mb-7">
          <div className="text-xs uppercase tracking-[0.2em] text-blue-400">Univer Observer</div>
          <h1 className="mt-2 text-2xl font-semibold">Observer Console</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">独立于 Workspace 用户体系的部署观测入口。</p>
        </div>

        {status.isLoading ? <p className="text-sm text-slate-400">正在加载配置…</p> : null}
        {status.data && !status.data.githubOAuthEnabled ? (
          <Notice>需要先配置 Observation 专用 GitHub OAuth App。</Notice>
        ) : null}

        {status.data && !status.data.initialized ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-medium">初始化首位成员</h2>
              <p className="mt-1 text-sm text-slate-400">
                输入部署 Secret 中的 <code>OBSERVER_SETUP_TOKEN</code>，随后使用 GitHub 登录。
              </p>
            </div>
            {!status.data.setupTokenConfigured ? (
              <Notice>服务端尚未配置 OBSERVER_SETUP_TOKEN，Console 当前保持锁定。</Notice>
            ) : (
              <>
                <input
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="一次性安装 Token"
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  disabled={submitting || token.length < 32 || !status.data.githubOAuthEnabled}
                  onClick={() => void setup()}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "正在跳转…" : "验证 Token 并使用 GitHub 初始化"}
                </button>
              </>
            )}
          </div>
        ) : null}

        {status.data?.initialized ? (
          <a
            href="/api/auth/github/login?returnTo=%2F"
            className="block w-full rounded-lg bg-blue-600 px-4 py-2.5 text-center font-medium text-white hover:bg-blue-500"
          >
            使用 GitHub 登录
          </a>
        ) : null}

        {oauthError || error ? (
          <p className="mt-4 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {oauthError ?? error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function Notice({ children }: { readonly children: React.ReactNode }) {
  return <p className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{children}</p>;
}
