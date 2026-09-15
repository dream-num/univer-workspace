/** Actual resource route and renderer, backed exclusively by in-memory fixture responses. */
export {};

const nativeFetch = window.fetch.bind(window);
const space = {
  id: "preview", name: "Design preview", type: "personal", accessRole: "owner", publicRead: false,
  capabilities: { browseRoot: true, createAtRoot: false, renameSpace: false, manageMembers: false, viewTrash: false },
};
const user = { id: "preview-user", username: "preview", displayName: "Preview", avatarUrl: null };
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
*{box-sizing:border-box}body{margin:0;background:#f7f8fb;color:#172238;font:15px system-ui;padding:clamp(24px,5vw,72px)}
main{max-width:1080px;margin:auto}small{color:#667085}h1{font-size:38px;letter-spacing:-1.5px;margin:14px 0}p{line-height:1.7;color:#667085}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:36px 0}.card{background:white;border:1px solid #e5e9f1;border-radius:16px;padding:26px}.value{font-size:36px;font-weight:650;margin-top:15px}
button,input{font:inherit;border:1px solid #d8deea;border-radius:8px;padding:10px 14px;background:white}button{cursor:pointer}input{width:100%;margin:12px 0}
.note{background:white;border:1px solid #e5e9f1;border-radius:16px;padding:26px}dialog{border:1px solid #e5e9f1;border-radius:16px;padding:28px}dialog::backdrop{background:#17223855}@media(max-width:640px){.cards{grid-template-columns:1fr}h1{font-size:30px}}
</style></head><body><main><small>UNIVER · WORKSPACE PREVIEW</small><h1>业务概览</h1><p>直接查看内容，保持专注。使用浏览器后退返回标准视图。</p>
<div class="cards"><section class="card">本月收入<div class="value">¥128,600</div><p>较上月增长 12.8%</p></section><section class="card">活跃客户<div class="value">2,418</div><p>较上月新增 186 位</p></section><section class="card">完成率<div class="value">94.2%</div><p>团队目标进展顺利</p></section></div>
<section class="note"><strong>会议备注</strong><input aria-label="会议备注" placeholder="输入内容，切换视图后仍保留"><button id="open">打开详情</button><p id="identity"></p></section>
<dialog><h2>本月详情</h2><p>详细数据可在这里继续查看。</p><button id="close">关闭</button></dialog>
</main><script>
document.getElementById('identity').textContent='页面实例：'+Math.random().toString(36).slice(2,8);
document.getElementById('open').onclick=()=>document.querySelector('dialog').showModal();
document.getElementById('close').onclick=()=>document.querySelector('dialog').close();
</script></body></html>`;
const node = (id: string) => ({
  id, name: id === "text" ? "阅读说明" : "业务概览.univer.html", spaceId: space.id, parentNodeId: null,
  accessRole: "owner", hasChildren: false, updatedAt: "2026-09-15T00:00:00Z",
  capabilities: { browseChildren: false, createChildren: false, rename: false, move: false, trash: false, share: true },
  resource: {
    id, kind: "blob",
    mediaType: id === "text" ? "text/plain" : "text/html", byteSize: new TextEncoder().encode(html).length,
    availability: "ready", capabilities: { openContent: true, editContent: false, downloadContent: true },
  },
});
window.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return nativeFetch(input, init);
  let result: unknown;
  if (url.pathname === "/api/session") result = {
    authenticated: true, githubOAuthEnabled: false, discordOAuthEnabled: false, user,
    authenticationMethods: { password: true, externalIdentities: [] },
  };
  else if (url.pathname === "/api/spaces") result = { spaces: [space] };
  else if (url.pathname === "/api/worktrees") result = { items: [] };
  else if (url.pathname.endsWith("/link-sharing")) result = { enabled: true, role: "viewer" };
  else if (url.pathname.endsWith("/grants")) result = { grants: [] };
  else if (url.pathname.includes("/users")) result = { users: [] };
  else if (url.pathname.endsWith("/content")) return new Response(url.pathname.includes("/text/") ? "这是普通文本资源，同样支持沉浸视图。" : html);
  else if (url.pathname.startsWith("/api/resources/")) {
    const id = url.pathname.split("/")[3] ?? "html";
    const item = node(id);
    result = { node: item, resource: {
      ...item.resource, originalFilename: id === "text" ? "notes.txt" : "dashboard.univer.html", name: item.name, spaceId: space.id, accessRole: "owner",
      contentUrl: `/api/blob-resources/${id}/content`, downloadUrl: `/api/blob-resources/${id}/download`,
    } };
  } else if (url.pathname.startsWith("/api/nodes/")) result = { node: node(url.pathname.split("/")[3] ?? "html"), space, breadcrumbs: [] };
  else if (url.pathname === "/api/spaces/preview/nodes") result = { nodes: [node("html"), node("text")], space, breadcrumbs: [], nextCursor: null };
  else return Response.json({ message: "Not available in the isolated preview" }, { status: 404 });
  return Response.json(result);
};
if (!location.pathname.startsWith("/nodes/")) history.replaceState(null, "", "/nodes/html" + location.search);
await import("../../web/src/app/entry");
