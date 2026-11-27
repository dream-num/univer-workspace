import { requestTier, type AccessTier, type McpScope } from "./access-tokens.js";
import { deriveDisplayName } from "./display-name.js";
import type { StoredAgent } from "./identity.repository.js";
import { agentClientLabel } from "./identity.service.js";
import type { User } from "./identity.types.js";

const OWNED_AGENT_CHOICES = 5;

export const OWNED_AGENT_LINES: Readonly<Record<AccessTier, readonly string[]>> = {
  read: [
    "It works in its own space and sees your files only when you share them.",
    "It can read, and cannot change anything.",
  ],
  read_write: [
    "It works in its own space and sees your files only when you share them.",
    "You own the repositories it creates, except forks, which stay with it.",
    "It can create and edit files, and open and merge pull requests where a repository allows it.",
    "It can make its own repositories public, add members, or share its files by link without asking you.",
  ],
};

export const TRIAL_LINES: Readonly<Record<AccessTier, readonly string[]>> = {
  read: [
    "A temporary agent with an empty space of its own. No account needed.",
    "It cannot read anyone's private files.",
    "It can read, and cannot change anything.",
  ],
  read_write: [
    "A temporary agent with an empty space of its own. No account needed.",
    "It cannot read anyone's private files.",
    "Its files are paused after 30 days without use. To keep them, ask it for a claim link.",
  ],
};

export interface McpAuthorizationRequestView {
  readonly client: { readonly clientName: string | null; readonly host?: string };
  readonly clientId: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly scopes: readonly McpScope[];
}

export interface ClientView {
  readonly name: string;
  readonly clientId: string;
  readonly resource: string;
  readonly returnsTo: string;
}

export type AgentOption =
  | { readonly kind: "existing"; readonly agent: StoredAgent }
  | { readonly kind: "new"; readonly name: string };

export type AccessOffer = { readonly kind: "read_only" } | { readonly kind: "toggle" };

export type TrialOffer =
  | { readonly kind: "off" }
  | { readonly kind: "offered" }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface PersonPage {
  readonly state: "person";
  readonly client: ClientView;
  readonly person: Pick<User, "displayName" | "username">;
  readonly primary: AgentOption | null;
  readonly others: readonly StoredAgent[];
  readonly newAgentRefusal: string | null;
  readonly access: AccessOffer;
  readonly consentToken: string;
}

export interface SignedOutPage {
  readonly state: "signed_out";
  readonly client: ClientView;
  readonly signInUrl: string;
  readonly trial: TrialOffer;
  readonly trialTier: AccessTier;
  readonly oauthAuthorization: string;
  readonly denyUrl: string;
}

export type ConnectPage = PersonPage | SignedOutPage;

/** A private-use URI has the opaque origin "null", so CSP and the page name it by its scheme. */
export function callbackSource(redirectUri: string): string {
  const callback = new URL(redirectUri);
  return callback.origin === "null" ? callback.protocol : callback.origin;
}

export function clientView(request: McpAuthorizationRequestView): ClientView {
  const clientName = deriveDisplayName(request.client.clientName);
  const host = request.client.host;
  return {
    name: host === undefined ? clientName || "An unnamed application" : clientName === "" ? host : `${clientName} (${host})`,
    clientId: request.clientId,
    resource: request.resource,
    returnsTo: callbackSource(request.redirectUri),
  };
}

export function personPage(input: {
  readonly request: McpAuthorizationRequestView;
  readonly person: Pick<User, "displayName" | "username">;
  readonly owned: readonly StoredAgent[];
  readonly newAgentRefusal: string | null;
  readonly consentToken: string;
}): PersonPage {
  const label = agentClientLabel(input.request.client.clientName);
  const match = label === "" ? undefined : input.owned.find((agent) => agent.originLabel === label);
  const top = input.owned.slice(0, OWNED_AGENT_CHOICES);
  const listed = match === undefined || top.includes(match) ? top : [...top.slice(0, -1), match];
  const fallback = match ?? (input.newAgentRefusal === null ? undefined : listed[0]);
  const primary: AgentOption | null = fallback !== undefined
    ? { kind: "existing", agent: fallback }
    : input.newAgentRefusal === null ? { kind: "new", name: label || "agent" } : null;
  return {
    state: "person",
    client: clientView(input.request),
    person: { displayName: input.person.displayName, username: input.person.username },
    primary,
    others: listed.filter((agent) => agent !== fallback),
    newAgentRefusal: match === undefined ? input.newAgentRefusal : null,
    access: requestTier(input.request.scopes) === "read_write" ? { kind: "toggle" } : { kind: "read_only" },
    consentToken: input.consentToken,
  };
}

export function signedOutPage(input: {
  readonly request: McpAuthorizationRequestView;
  readonly signInUrl: string;
  readonly oauthAuthorization: string;
  readonly denyUrl: string;
  readonly trial: TrialOffer;
}): SignedOutPage {
  return {
    state: "signed_out",
    client: clientView(input.request),
    signInUrl: input.signInUrl,
    trial: input.trial,
    trialTier: requestTier(input.request.scopes),
    oauthAuthorization: input.oauthAuthorization,
    denyUrl: input.denyUrl,
  };
}

export function renderConnectPage(page: ConnectPage): string {
  const client = page.client;
  const request = `<p><strong>${escapeHtml(client.name)}</strong> wants to work in Univer Workspace.</p><p class="meta">The name is chosen by the application. Server: ${escapeHtml(client.resource)}. Returns to: ${escapeHtml(client.returnsTo)}. Client ID: ${escapeHtml(client.clientId)}.</p>`;
  return documentHtml(`Connect ${client.name}`, "Connect an AI assistant", `<div class="request">${request}</div>${page.state === "person" ? personBody(page) : signedOutBody(page)}`, CONNECT_CSS);
}

function personBody(page: PersonPage): string {
  const primary = page.primary;
  const works = primary === null
    ? ""
    : primary.kind === "existing"
      ? ` It will work as your agent <strong>${escapeHtml(primary.agent.user.displayName)}</strong>.`
      : ` It will work as a new agent of yours, <strong>${escapeHtml(primary.name)}</strong>.`;
  const access = page.access.kind === "toggle"
    ? `<label class="toggle"><input type="checkbox" name="access" value="read_write" checked><span><strong>Let it change content</strong> When this is off, it can only read.</span></label>${lines(OWNED_AGENT_LINES.read, "read")}${lines(OWNED_AGENT_LINES.read_write, "read_write")}`
    : lines(OWNED_AGENT_LINES.read);
  const primaryButton = primary === null
    ? ""
    : `<button type="submit" class="primary" name="connect_as" value="${primary.kind === "existing" ? escapeHtml(primary.agent.user.id) : "new_agent"}">Connect as ${primary.kind === "existing" ? escapeHtml(primary.agent.user.displayName) : "a new agent"}</button>`;
  const refusal = page.newAgentRefusal === null ? "" : `<p class="note warn">${escapeHtml(page.newAgentRefusal)}</p>`;
  const others = page.others.length === 0
    ? ""
    : `<p class="label">Or connect as another of your agents</p><div class="agents">${page.others.map((agent) => `<button type="submit" name="connect_as" value="${escapeHtml(agent.user.id)}"><strong>${escapeHtml(agent.user.displayName)}</strong> @${escapeHtml(agent.user.username)}</button>`).join("")}</div>`;
  return `<form method="post" action="/api/auth/authorize/consent"><input type="hidden" name="consent_token" value="${escapeHtml(page.consentToken)}">`
    + `<p class="lead">You're signed in as <strong>@${escapeHtml(page.person.username)}</strong>.${works}</p>${access}${primaryButton}${refusal}${others}`
    + `<div class="secondary"><button type="submit" class="link" name="connect_as" value="self">Connect as myself</button><button type="submit" class="link" name="decision" value="deny">Deny</button></div>`
    + `<p class="note">Connecting as yourself lets it act as ${escapeHtml(page.person.displayName)}, with everything you can open.</p></form>`;
}

function signedOutBody(page: SignedOutPage): string {
  const trial = page.trial.kind === "off"
    ? ""
    : page.trial.kind === "offered"
      ? `<form method="post" action="/api/auth/authorize/guest"><input type="hidden" name="oauthAuthorization" value="${escapeHtml(page.oauthAuthorization)}"><button type="submit" class="button">Try without signing in</button></form>${lines(TRIAL_LINES[page.trialTier])}`
      : `<button type="button" class="button" disabled>Try without signing in</button><p class="note warn">${escapeHtml(page.trial.reason)}</p>`;
  return `<a class="primary" href="${escapeHtml(page.signInUrl)}">Sign in to connect</a>`
    + `<p class="note">Signed in, it works as an agent that you own and sees your files only when you share them. After you sign in, you come back to this page to connect.</p>`
    + `${trial}<div class="secondary"><a class="link" href="${escapeHtml(page.denyUrl)}">Deny</a></div>`;
}

function lines(items: readonly string[], tier?: AccessTier): string {
  return `<ul class="lines"${tier === undefined ? "" : ` data-tier="${tier}"`}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function renderStaticConsentPage(clientId: string, scope: string, displayName: string, consentToken: string): string {
  return documentHtml(
    `Authorize ${clientId}`,
    "Authorize external client",
    `<div class="request"><p><strong>${escapeHtml(clientId)}</strong> requests access as <strong>${escapeHtml(displayName)}</strong>.</p><p class="meta">Requested scopes: ${escapeHtml(scope)}</p></div>`
      + `<form method="post" action="/api/auth/authorize/consent"><input type="hidden" name="consent_token" value="${escapeHtml(consentToken)}"><div class="actions"><button type="submit" name="decision" value="deny">Deny</button><button type="submit" name="decision" value="allow">Allow</button></div></form>`,
  );
}

export function renderAuthorizationError(input: { readonly title: string; readonly code: string; readonly message: string; readonly back?: string }): string {
  const back = input.back === undefined ? "" : `<div class="secondary"><a class="link" href="${escapeHtml(input.back)}">Back to the connect page</a></div>`;
  return documentHtml(input.title, input.title, `<div class="request"><p>${escapeHtml(input.message)}</p><p class="meta">Error: ${escapeHtml(input.code)}</p></div>${back}`, CONNECT_CSS);
}

function documentHtml(title: string, heading: string, body: string, css = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | Univer Workspace</title><style>${BASE_CSS}${css}
  </style></head><body><main><section class="card" aria-labelledby="consent-title"><div class="brand"><span class="logo" aria-hidden="true">U</span><div><p class="eyebrow">Univer Workspace</p><h1 id="consent-title">${escapeHtml(heading)}</h1></div></div>${body}</section></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

const BASE_CSS = `
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#f6f7fb;color-scheme:light}
    *{box-sizing:border-box}body{margin:0;min-width:320px;min-height:100vh;background:radial-gradient(circle at 15% 10%,#e9e7ff 0,transparent 38%),radial-gradient(circle at 90% 90%,#dff5f2 0,transparent 42%),#f6f7fb}
    main{display:grid;min-height:100vh;place-items:center;padding:32px 20px}.card{width:min(440px,100%);padding:32px;border:1px solid #e2e4ea;border-radius:20px;background:#fff;box-shadow:0 18px 50px #252a3d14}.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}.logo{display:grid;width:42px;height:42px;place-items:center;border-radius:12px;background:linear-gradient(135deg,#7167e8,#5147bd);color:#fff;font-weight:800;letter-spacing:-.04em}.eyebrow{margin:0 0 5px;color:#6b6f7b;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{margin:0;font-size:22px;line-height:1.25;letter-spacing:-.02em}p{margin:0;color:#5c606d;font-size:14px;line-height:1.55}.request{margin:0 0 24px;padding:16px;border-radius:12px;background:#f6f7fb}.request strong{color:#171717;font-size:15px;overflow-wrap:anywhere}.meta{margin-top:8px;color:#6b6f7b;font-size:13px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}.actions button{min-height:44px;padding:0 16px;border:1px solid #d8dbe4;border-radius:10px;background:#fff;color:#30333d;font:inherit;font-weight:650;cursor:pointer}.actions button:hover{background:#f6f7fb}.actions button[value=allow]{border-color:#5b50d6;background:#5b50d6;color:#fff}.actions button[value=allow]:hover{background:#4e43c7}@media(max-width:480px){main{padding:16px}.card{padding:24px;border:0;box-shadow:none}}`;

const CONNECT_CSS = `.lead{margin-bottom:16px;color:#30333d}.lead strong{color:#171717;overflow-wrap:anywhere}.toggle{display:flex;gap:10px;align-items:flex-start;margin-bottom:12px;padding:12px 14px;border:1px solid #e2e4ea;border-radius:12px;color:#5c606d;font-size:14px;line-height:1.45;cursor:pointer}.toggle input{margin-top:3px}.toggle strong{display:block;color:#171717}.toggle:has(input:checked){border-color:#5b50d6;background:#f4f3ff}.lines{margin:0 0 20px;padding-left:20px;color:#5c606d;font-size:13px;line-height:1.55}form+.lines{margin-top:10px}form:has(input[name=access]:checked) .lines[data-tier=read],form:has(input[name=access]:not(:checked)) .lines[data-tier=read_write]{display:none}.primary,.button{display:flex;width:100%;min-height:44px;align-items:center;justify-content:center;padding:0 16px;border:1px solid #5b50d6;border-radius:10px;background:#5b50d6;color:#fff;font:inherit;font-size:15px;font-weight:650;text-decoration:none;cursor:pointer}.primary:hover{background:#4e43c7}.button{margin-top:20px;border-color:#d8dbe4;background:#fff;color:#30333d}.button:hover{background:#f6f7fb}.button:disabled{cursor:default;opacity:.6}.label{margin:20px 0 8px;color:#30333d;font-weight:650}.agents{display:grid;gap:8px}.agents button{padding:10px 14px;border:1px solid #e2e4ea;border-radius:10px;background:#fff;color:#5c606d;font:inherit;font-size:13px;text-align:left;cursor:pointer}.agents button:hover{border-color:#5b50d6;background:#f4f3ff}.agents strong{margin-right:6px;color:#171717;font-size:14px}.note{margin-top:10px;font-size:13px}.warn{color:#a1361f}.secondary{display:flex;gap:16px;justify-content:space-between;margin-top:20px}.link{padding:0;border:0;background:none;color:#5147bd;font:inherit;font-size:14px;font-weight:650;text-decoration:none;cursor:pointer}.link:hover{text-decoration:underline}`;
