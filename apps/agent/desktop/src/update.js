const api = window.workspaceUpdates;
const zh = navigator.language.toLowerCase().startsWith("zh");
const text = (en, cn) => zh ? cn : en;
const $ = id => document.getElementById(id);
document.documentElement.lang = zh ? "zh-CN" : "en";
$("title").textContent = text("Software update", "软件更新");
$("pause").textContent = text("Pause", "暂停");
$("notes-title").textContent = text("What's new", "更新内容");
$("releases").textContent = text("Download an installer from GitHub", "从 GitHub 下载安装包");
$("pause").onclick = () => api.pause();
$("releases").onclick = () => api.releases();
const labels = {
  idle: ["Check for a new version", "检查新版本"],
  checking: ["Checking for updates…", "正在检查更新…"],
  current: ["You are up to date", "已是最新版本"],
  disabled: ["Preview build", "预览构建"],
  available: ["An update is available", "发现新版本"],
  downloading: ["Downloading update…", "正在下载更新…"],
  retrying: ["Connection interrupted — retrying", "连接中断，正在自动重试"],
  paused: ["Download paused", "下载已暂停"],
  verifying: ["Verifying download…", "正在校验下载文件…"],
  staging: ["Preparing installation…", "正在准备安装…"],
  ready: ["Ready to install", "更新已准备好"],
  installing: ["Restarting to install…", "正在重启安装…"],
  "install-error": ["Installation could not start", "无法开始安装"],
  "check-error": ["Could not check for updates", "检查更新失败"],
  "download-error": ["Download did not finish", "下载未完成"],
};
function render(state) {
  const phase = state.phase;
  $("version").textContent = text("Current version: ", "当前版本：") + state.currentVersion +
    (state.version ? text(" → New version: ", " → 新版本：") + state.version : "");
  $("status").textContent = text(...labels[phase]);
  $("description").textContent = phase === "disabled" ? text("Use an official release installer to enable updates.", "安装正式发布的安装包后即可使用更新功能。") :
    phase === "check-error" ? text("Check your connection and try again.", "请检查网络连接后重试。") :
    phase === "download-error" ? text("Check your connection and free disk space, then retry. Saved data will be reused when valid.", "请检查网络连接和剩余磁盘空间后重试，有效的已下载数据会继续使用。") :
    phase === "install-error" ? text("Restart the app to restore the local service, then retry the update or use the installer below.", "请重启应用以恢复本地服务，然后重试更新，或从下方下载安装包。") :
    state.installError ? text("Could not close the local service. Finish active tasks and retry installation.", "无法关闭本地服务，请结束正在执行的任务后重试安装。") :
    phase === "ready" ? text("Finish active tasks before restarting. Your account and workspace data are preserved.", "请先结束正在执行的任务，再重启安装。账号和工作空间数据会保留。") :
    phase === "retrying" ? text(`Retry ${state.attempt}/3 in ${state.seconds} seconds.`, `${state.seconds} 秒后进行第 ${state.attempt}/3 次重试。`) : "";
  const transfer = ["downloading", "retrying", "paused", "download-error"].includes(phase);
  const busy = ["checking", "downloading", "retrying", "verifying", "staging", "installing"].includes(phase);
  $("progress").hidden = !busy && !transfer;
  if (transfer && Number.isFinite(state.percent)) $("progress").value = state.percent;
  else $("progress").removeAttribute("value");
  const mb = bytes => ((bytes ?? 0) / 1024 / 1024).toFixed(1);
  $("transfer").textContent = transfer && state.total ?
    `${(state.percent ?? 0).toFixed(1)}% · ${mb(state.transferred)} / ${mb(state.total)} MB` +
    (phase === "downloading" ? ` · ${mb(state.bytesPerSecond)} MB/s` : "") : "";
  $("pause").hidden = !["downloading", "retrying", "verifying"].includes(phase);
  $("action").disabled = busy;
  $("action").hidden = ["disabled", "install-error"].includes(phase);
  const download = ["available", "paused", "download-error"].includes(phase);
  $("action").textContent = phase === "ready" ? text("Restart and install", "重启并安装") :
    phase === "paused" ? text("Resume download", "继续下载") :
    phase === "download-error" ? text("Retry download", "重试下载") :
    download ? text("Download update", "下载更新") : text("Check for updates", "检查更新");
  $("action").onclick = () => phase === "ready" ? api.install() : download ? api.download() : api.check();
  $("hint").textContent = ["downloading", "retrying", "verifying", "staging"].includes(phase) ?
    text("You can close this window and keep working. Downloading will continue without restarting the app.", "可以关闭此窗口继续工作，下载会在后台继续，不会自动重启应用。") : "";
  $("notes-panel").hidden = !state.notes;
  $("notes").textContent = state.notes ?? "";
}
api.subscribe(render);
void api.getState().then(render);
