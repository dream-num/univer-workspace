import { expect, it } from "vitest";
import type { components } from "../../../../generated/http/schema.js";
import { claimLanding } from "./claim-landing";

const agent = {
  id: "agent-1", username: "workbuddy-connector-sjds", displayName: "WorkBuddy Connector · sjds", avatarUrl: null,
  spaceId: "agent-personal", files: 0, lastActiveAt: 1_800_000_000_000, stopped: false,
} satisfies components["schemas"]["AgentSummary"];

function space(id: string, type: "personal" | "team", ownerId: string): components["schemas"]["MySpaceView"] {
  return {
    id, type, name: id, publicRead: false, accessRole: "owner", affiliation: "owner",
    capabilities: {
      browseRoot: true, createAtRoot: true, renameSpace: true, manageMembers: true, viewTrash: true,
      createIssue: true, triageIssues: true, manageIssueLabels: true, propose: true,
    },
    owner: { id: ownerId, username: ownerId }, description: "", slug: null, fullName: null,
    proposals: "members", acceptAfterHours: null, landing: "review",
  };
}

const mine = [space("person-personal", "personal", "person-1"), space("person-team", "team", "person-1"), space("agent-personal", "personal", "agent-1")];
const repository = (spaceId: string) => ({ to: "/spaces/$spaceId", params: { spaceId }, search: {} });

it("opens the agent's one Team repository when its Personal Space is empty, ignoring the person's own", () => {
  expect(claimLanding(agent, [...mine, space("budget", "team", "agent-1")])).toEqual(repository("budget"));
});

it("opens the agent's Personal Space when its work is there or nowhere", () => {
  expect(claimLanding({ ...agent, files: 3 }, mine)).toEqual(repository("agent-personal"));
  expect(claimLanding(agent, mine)).toEqual(repository("agent-personal"));
  expect(claimLanding(agent, []), "a failed list still lands on the Personal Space").toEqual(repository("agent-personal"));
});

it("lists the agent's repositories when its work is in more than one place", () => {
  const list = { to: "/repositories", search: { q: "workbuddy-connector-sjds" } };
  expect(claimLanding(agent, [...mine, space("budget", "team", "agent-1"), space("sales", "team", "agent-1")])).toEqual(list);
  expect(claimLanding({ ...agent, files: 1 }, [...mine, space("budget", "team", "agent-1")])).toEqual(list);
});
