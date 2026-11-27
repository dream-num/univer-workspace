import { describe, expect, it } from "vitest";
import { personPage, renderConnectPage, signedOutPage, type McpAuthorizationRequestView, type TrialOffer } from "./connect-page.js";
import type { StoredAgent } from "./identity.repository.js";

const request: McpAuthorizationRequestView = {
  client: { clientName: "Claude Code" },
  clientId: "client-1",
  redirectUri: "http://127.0.0.1:9/callback",
  resource: "https://space.example.test/mcp",
  scopes: ["read", "write"],
};
const person = { displayName: "Alice", username: "alice" };

function agent(id: string, originLabel: string): StoredAgent {
  return { user: { id, username: `${id}-name`, displayName: `${id} display`, avatarUrl: null }, spaceId: `${id}-space`, ownerUserId: "alice-id", originLabel, lastActiveAt: 0, banned: false, files: 0 };
}

function page(owned: readonly StoredAgent[], newAgentRefusal: string | null = null, scopes = request.scopes) {
  return personPage({ request: { ...request, scopes }, person, owned, newAgentRefusal, consentToken: "token-1" });
}

describe("the connect page for a signed-in person", () => {
  it("offers first the agent made for this client, else a new agent, else the latest agent, else nothing", () => {
    const [recent, made, older] = [agent("recent", "opencode"), agent("made", "Claude Code"), agent("older", "Writer")];
    expect(page([recent, made, older]).primary).toEqual({ kind: "existing", agent: made });
    expect(page([recent, older]).primary).toEqual({ kind: "new", name: "Claude Code" });
    expect(page([recent, older], "Too many agents.").primary).toEqual({ kind: "existing", agent: recent });
    expect(page([], "Too many agents.").primary).toBeNull();
  });

  it("lists the other agents without the primary one, keeping the client's agent past five newer ones", () => {
    const newer = ["a", "b", "c", "d", "e"].map((id) => agent(id, "opencode"));
    const made = agent("made", "Claude Code");
    const crowded = page([...newer, made]);
    expect(crowded.primary).toEqual({ kind: "existing", agent: made });
    expect(crowded.others.map((other) => other.user.id)).toEqual(["a", "b", "c", "d"]);
    expect(page(newer).others.map((other) => other.user.id), "a new agent leaves all five listed").toEqual(["a", "b", "c", "d", "e"]);
  });

  it("names the refusal only when it is why the primary choice is not a new agent", () => {
    expect(page([], "Too many agents.").newAgentRefusal).toBe("Too many agents.");
    expect(page([agent("made", "Claude Code")], "Too many agents.").newAgentRefusal).toBeNull();
  });

  it("shows the content toggle, on, only when the client asked to write", () => {
    const html = renderConnectPage(page([]));
    expect(html).toContain('<input type="checkbox" name="access" value="read_write" checked>');
    expect(html).toContain('name="connect_as" value="new_agent"');
    const readOnly = renderConnectPage(page([], null, ["read", "publish"]));
    expect(readOnly).not.toContain('name="access"');
    expect(readOnly).toContain("It can read, and cannot change anything.");
  });

  it("tells the person that widening who can see data waits for their confirmation", () => {
    const html = renderConnectPage(page([]));
    expect(html).toContain("it gives you a link to confirm in the browser.");
    expect(html).not.toContain("without asking you");
  });

  it("escapes what the client and the agents name themselves", () => {
    const hostile = renderConnectPage(personPage({
      request: { ...request, client: { clientName: "<script>x</script>", host: "evil.example" } },
      person,
      owned: [{ ...agent("a", "opencode"), user: { id: 'a"b', username: "a<b", displayName: "<img src=x>", avatarUrl: null } }],
      newAgentRefusal: null,
      consentToken: 'token"1',
    }));
    expect(hostile).toContain("&lt;script&gt;x&lt;/script&gt; (evil.example)");
    expect(hostile).toContain("&lt;img src=x&gt;");
    expect(hostile).toContain('value="a&quot;b"');
    expect(hostile).toContain('value="token&quot;1"');
    expect(hostile).not.toMatch(/<script|<img/u);
  });
});

describe("the connect page with nobody signed in", () => {
  const signedOut = (trial: TrialOffer, scopes = request.scopes) => signedOutPage({
    request: { ...request, scopes },
    signInUrl: "/login?returnTo=%2Fapi%2Fauth%2Fauthorize%3Fclient_id%3Dclient-1",
    oauthAuthorization: "client_id=client-1&scope=read+write",
    denyUrl: "http://127.0.0.1:9/callback?error=access_denied",
    trial,
  });

  it("carries no consent token, since no person can spend one", () => {
    const state = signedOut({ kind: "offered" });
    expect(state).not.toHaveProperty("consentToken");
    expect(renderConnectPage(state)).not.toContain("consent_token");
  });

  it("posts the try button to the guest endpoint, and leaves it out when guests are off", () => {
    const offered = renderConnectPage(signedOut({ kind: "offered" }));
    expect(offered).toContain('<form method="post" action="/api/auth/authorize/guest"><input type="hidden" name="oauthAuthorization" value="client_id=client-1&amp;scope=read+write">');
    expect(offered).toContain('href="/login?returnTo=%2Fapi%2Fauth%2Fauthorize%3Fclient_id%3Dclient-1"');
    expect(offered).toContain('href="http://127.0.0.1:9/callback?error=access_denied"');
    expect(renderConnectPage(signedOut({ kind: "off" }))).not.toContain("Try without signing in");
    const unavailable = renderConnectPage(signedOut({ kind: "unavailable", reason: "Too many agents were created from this address." }));
    expect(unavailable).toContain('<button type="button" class="button" disabled>Try without signing in</button>');
    expect(unavailable).toContain("Too many agents were created from this address.");
    expect(unavailable).not.toContain("/api/auth/authorize/guest");
  });

  it("promises a handoff link only to a trial that may write", () => {
    expect(renderConnectPage(signedOut({ kind: "offered" }))).toContain("ask it for a handoff link");
    const readOnly = renderConnectPage(signedOut({ kind: "offered" }, ["read"]));
    expect(readOnly).toContain("It can read, and cannot change anything.");
    expect(readOnly).not.toContain("handoff link");
  });
});
