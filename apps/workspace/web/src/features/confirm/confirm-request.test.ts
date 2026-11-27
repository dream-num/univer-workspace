import { expect, it } from "vitest";
import { confirmLevelLabel, confirmText, parseConfirmRequest, type ConfirmRequest } from "./confirm-request";

const parse = (action: string, query: string) => parseConfirmRequest(action, new URLSearchParams(query));
const t = (key: string, values?: Readonly<Record<string, string | number>>) => `${key}${values ? JSON.stringify(values) : ""}`;

it("reads only the keys of the action and ignores every other one", () => {
  expect(parse("public", "space=s1&role=admin&user=u9&title=Trust+me")).toEqual({ action: "public", spaceId: "s1" });
  expect(parse("member", "space=s1&user=u2&role=admin&node=n9")).toEqual({ action: "member", spaceId: "s1", userId: "u2", role: "admin" });
  expect(parse("grant", "node=n1&user=u2&role=viewer&space=s9")).toEqual({ action: "grant", nodeId: "n1", userId: "u2", role: "viewer" });
  expect(parse("link-sharing", "node=n1&role=editor&user=u9")).toEqual({ action: "link-sharing", nodeId: "n1", role: "editor" });
  expect(parse("public", "space=123"), "an ID that looks like a number stays text").toEqual({ action: "public", spaceId: "123" });
});

it("treats a missing ID, an unknown role or an unknown action as an invalid link", () => {
  for (const [action, query] of [
    ["public", ""], ["public", "space="], ["member", "space=s1&role=editor"], ["member", "space=s1&user=u2"],
    ["member", "space=s1&user=u2&role=owner"], ["grant", "node=n1&user=u2&role=admin"], ["grant", "space=s1&user=u2&role=viewer"],
    ["link-sharing", "node=n1"], ["link-sharing", "node=n1&role=admin"], ["create-public", "space=s1"], ["delete", "space=s1"],
  ] as const) {
    expect(parse(action, query), `${action}?${query}`).toBeNull();
  }
});

it("builds the title and the consequence from the names the session read, and from nothing in the link", () => {
  const names = { repository: "acme/site", file: "Plan", user: "Wang (@wang)" };
  const requests: readonly ConfirmRequest[] = [
    { action: "public", spaceId: "LINK-SPACE" },
    { action: "member", spaceId: "LINK-SPACE", userId: "LINK-USER", role: "editor" },
    { action: "grant", nodeId: "LINK-NODE", userId: "LINK-USER", role: "viewer" },
    { action: "link-sharing", nodeId: "LINK-NODE", role: "editor" },
  ];
  const text = requests.map((request) => confirmText(request, names, t));
  expect(JSON.stringify(text)).not.toContain("LINK-");
  expect(text.map(({ title }) => title.split("{")[0])).toEqual(["confirmPublicTitle", "confirmMemberTitle", "confirmGrantTitle", "confirmLinkTitle"]);
  expect(text.map(({ consequence }) => consequence.split("{")[0]))
    .toEqual(["confirmPublicConsequence", "confirmMemberEditor", "confirmGrantViewer", "confirmLinkEditor"]);
  expect(text[1]!.consequence).toContain("Wang (@wang)");
  expect(confirmText(requests[2]!, { ...names, folder: true }, t).consequence).toMatch(/ confirmFolderCovers$/);
});

it("labels the stored level and the new one for each action", () => {
  expect(confirmLevelLabel("public", null, t)).toBe("repositoryVisibilityPrivate");
  expect(confirmLevelLabel("public", "public", t)).toBe("repositoryVisibilityPublic");
  expect(confirmLevelLabel("member", null, t)).toBe("confirmNotMember");
  expect(confirmLevelLabel("member", "admin", t)).toBe("accessAdmin");
  expect(confirmLevelLabel("grant", null, t)).toBe("confirmNotShared");
  expect(confirmLevelLabel("link-sharing", null, t)).toBe("linkSharingOff");
  expect(confirmLevelLabel("link-sharing", "viewer", t)).toBe("accessViewer");
});
