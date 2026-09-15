import { useEffect, useState } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import type { DesktopDiagnostics } from "./desktop-host.ts";
import type { UniverLocaleKey } from "./locales.ts";
import css from "./DesktopSettings.module.scss";

/** DSH owns the settings surface; the optional Desktop host owns diagnostics. */
export function DesktopSettings({ t }: PropsLocale<"univer">) {
  const host = window.workspaceDesktop;
  const [report, setReport] = useState<DesktopDiagnostics>();
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  useEffect(() => {
    if (!host) return;
    let live = true, pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await host.diagnostics();
        if (live) { setReport(next); setError(false); }
      } catch { if (live) setError(true); }
      finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, [host]);
  if (!host) return null;
  const exportReport = async () => {
    setExporting(true); setExported(false);
    try { setExported(await host.exportDiagnostics()); }
    catch { setError(true); }
    finally { setExporting(false); }
  };
  const update = report?.update;
  const phaseLabel = update?.phase ? t(`desktop.phase.${update.phase}` as UniverLocaleKey) : "—";
  const mb = (bytes: number | undefined) => ((bytes ?? 0) / 1024 / 1024).toFixed(1);
  const failures = [...(report?.previousStartup ?? []), ...(report?.startup ?? []), ...(report?.recentUpdates ?? [])]
    .filter(event => event.code).sort((a, b) => (b.time ?? "").localeCompare(a.time ?? "")).slice(0, 6);
  return (
    <section className={css.panel} aria-label={t("desktop.diagnostics")}>
      <h3>{t("desktop.aboutTitle")}</h3>
      <p className={css.hint}>{t("desktop.diagnosticsHint")}</p>
      <div className={css.actions}>
        <Button onClick={() => void host.openUpdates().catch(() => setError(true))}>{t("desktop.checkUpdates")}</Button>
        <Button disabled={exporting} onClick={() => void exportReport()}>{t("desktop.export")}</Button>
        {exported && <span role="status">{t("desktop.exported")}</span>}
      </div>
      {error && <p role="alert">{t("desktop.diagnosticsError")}</p>}
      {report && <>
        <dl className={css.facts}>
          <dt>{t("desktop.version")}</dt><dd><code>{report.application.version}</code></dd>
          <dt>{t("desktop.environment")}</dt><dd><code>{report.application.platform} {report.application.arch} · {report.application.osRelease}</code></dd>
          <dt>{t("desktop.runtime")}</dt><dd><code>DSH {report.application.dsh ?? "—"} · Electron {report.application.electron} · Node {report.application.node}</code></dd>
          <dt>{t("desktop.updateState")}</dt><dd>{report.application.updatesEnabled ? phaseLabel : t("desktop.phase.disabled")}{update?.version && <> · {update.version}</>}</dd>
        </dl>
        {update?.total !== undefined && <div className={css.download}>
          <progress max={100} value={update.percent ?? 0} aria-label={t("desktop.updateState")} />
          <span>{(update.percent ?? 0).toFixed(1)}% · {mb(update.transferred)} / {mb(update.total)} MB
            {update.phase === "downloading" && <> · {mb(update.bytesPerSecond)} MB/s</>}</span>
        </div>}
        <h4>{t("desktop.startup")}</h4>
        <table><thead><tr><th>{t("desktop.phase")}</th><th>{t("desktop.duration")}</th><th>{t("desktop.elapsed")}</th></tr></thead>
          <tbody>{report.startup.filter(event => event.elapsedMs !== undefined).map((event, index, events) => (
            <tr key={`${event.time}-${index}`}><td><code>{event.phase}</code></td>
              <td>{Math.max(0, (event.elapsedMs ?? 0) - (events[index - 1]?.elapsedMs ?? 0))} ms</td>
              <td>{event.elapsedMs} ms</td></tr>
          ))}</tbody>
        </table>
        <h4>{t("desktop.failures")}</h4>
        {failures.length ? <ul>{failures.map((event, index) => <li key={`${event.time}-${index}`}>
          <time>{event.time ? new Date(event.time).toLocaleString() : "—"}</time>{" "}
          <code>{event.phase} · {event.code}{event.httpStatus ? ` · HTTP ${event.httpStatus}` : ""}</code>
        </li>)}</ul> : <p className={css.hint}>{t("desktop.noFailures")}</p>}
        <h4>{t("desktop.directories")}</h4>
        <div className={css.directories}>{Object.entries(report.directories).map(([id, path]) => (
          <div key={id}><div><strong>{t(`desktop.directory.${id}` as UniverLocaleKey)}</strong><code>{path}</code></div>
            <Button onClick={() => void host.openDirectory(id).catch(() => setError(true))}>{t("desktop.open")}</Button></div>
        ))}</div>
      </>}
    </section>
  );
}
