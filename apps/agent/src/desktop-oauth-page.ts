import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";

/** External-browser completion page. No local session cookie or access token. */
export function sendDesktopCallbackPage(res: ServerResponse, result: { state: string; code?: string; error?: string } | undefined, zh: boolean): void {
  const nonce = randomBytes(18).toString("base64url");
  const link = result ? `univer-workspace://login#${new URLSearchParams(result).toString()}` : undefined;
  const title = zh ? "返回 Univer Workspace" : "Return to Univer Workspace";
  const description = !result
    ? zh ? "登录请求已过期，请回到应用重新登录。" : "This sign-in request has expired. Start again in the app."
    : result.error
      ? zh ? "授权未完成。返回应用后可以重新登录或切换账号。" : "Authorization was not completed. Return to the app to try again or choose another account."
      : zh ? "请打开应用以完成登录。你可以关闭此页面。" : "Open the app to finish signing in. You can then close this page.";
  const safeLink = link?.replaceAll("&", "&amp;");
  const script = `<script nonce="${nonce}">history.replaceState(null, '', location.pathname);${link ? `location.href=${JSON.stringify(link).replaceAll("<", "\\u003c")};` : ""}</script>`;
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
  });
  res.end(`<!doctype html><html lang="${zh ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;margin:0;background:#f6f7fb;color:#171717;display:grid;min-height:100vh;place-items:center}main{max-width:420px;padding:32px;margin:20px;background:white;border:1px solid #e2e4ea;border-radius:16px}p{line-height:1.6}a{display:inline-block;padding:12px 18px;background:#5147bd;color:white;border-radius:8px;text-decoration:none}</style></head><body><main><h1>${title}</h1><p>${description}</p>${safeLink ? `<a href="${safeLink}">${zh ? "打开 Univer Workspace" : "Open Univer Workspace"}</a>` : ""}</main>${script}</body></html>`);
}
