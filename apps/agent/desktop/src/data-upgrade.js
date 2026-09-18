const strings = {
  en: {
    title: 'Preparing your workspace', failed: 'Local data upgrade could not finish',
    checking: 'Checking local data…', preparing: 'Preparing upgrade files…', migrating: 'Upgrading local data…',
    activating: 'Finishing the data upgrade…', backend: 'Starting Workspace Agent…',
    busy: 'Please keep this window open until preparation completes.',
    newer: 'This data was created by a newer version of Agent. Install a compatible newer version to continue.',
    invalid: 'The data version record could not be read. Open the logs and backup folder for troubleshooting. Do not delete your data to retry.',
    space: 'There is not enough disk space. Free up space, then retry.',
    permission: 'The data directory could not be accessed. Check folder permissions or files held by another application, then retry.',
    unknown: 'Preparation stopped. Open the logs for details. You can retry after resolving the cause.',
    installed: 'Program files are installed, but the data upgrade is incomplete. ',
    retry: 'Retry', logs: 'Open logs', backups: 'Open backup folder', exit: 'Exit',
    actionError: 'This action could not be completed. Please try again.',
  },
  zh: {
    title: '正在准备工作区', failed: '本地数据升级未完成',
    checking: '正在检查本地数据…', preparing: '正在准备升级文件…', migrating: '正在升级本地数据…',
    activating: '正在完成数据升级…', backend: '正在启动 Workspace Agent…',
    busy: '准备完成前，请保持此窗口打开。',
    newer: '这些数据由更新版本的 Agent 创建。请安装兼容的更新版本后继续。',
    invalid: '无法读取数据版本记录。请打开日志和备份目录排查，不要通过删除数据来重试。',
    space: '磁盘空间不足。请释放空间后重试。',
    permission: '无法访问数据目录。请检查目录权限或其他程序对文件的占用，然后重试。',
    unknown: '数据准备已停止。请打开日志查看原因，处理后可以重试。',
    installed: '程序文件已安装，但数据升级尚未完成。',
    retry: '重试', logs: '打开日志', backups: '打开备份目录', exit: '退出',
    actionError: '未能完成此操作，请重试。',
  },
};
const $ = id => document.getElementById(id);
let text = strings.en;
let reading = false;
async function refresh() {
  if (reading) return;
  reading = true;
  try {
    const state = await window.workspaceDataUpgrade.getState();
    text = state.locale?.startsWith('zh') ? strings.zh : strings.en;
    document.documentElement.lang = text === strings.zh ? 'zh-CN' : 'en';
    const failed = state.phase === 'failed';
    $('heading').textContent = failed ? text.failed : text.title;
    $('stage').textContent = failed ? (state.installer ? text.installed : '') + text[state.reason] : text[state.phase];
    $('detail').textContent = failed ? '' : text.busy;
    $('progress').hidden = failed;
    if (state.total) { $('progress').max = state.total; $('progress').value = state.completed; }
    else $('progress').removeAttribute('value');
    $('actions').hidden = !failed;
    $('retry').hidden = !state.retryable;
    for (const name of ['retry', 'logs', 'backups', 'exit']) $(name).textContent = text[name];
  } catch { /* The IPC is removed when the application replaces this page. */ }
  finally { reading = false; }
}
for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    $('action-error').textContent = '';
    try { await window.workspaceDataUpgrade.action(button.dataset.action); await refresh(); }
    catch { $('action-error').textContent = text.actionError; }
    finally { button.disabled = false; }
  });
}
void refresh();
setInterval(refresh, 200);
