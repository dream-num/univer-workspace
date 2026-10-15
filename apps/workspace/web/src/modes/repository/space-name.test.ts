import { expect, it } from "vitest";
import { spaceDisplayName } from "./space-name";

it("names personal repositories after their owner rather than the signed-in viewer", () => {
  const space = {
    type: "personal" as const,
    name: "Owner's personal space",
    owner: { id: "owner-id", username: "owner" },
  };
  expect(spaceDisplayName(space, () => "Personal", "viewer")).toBe("owner");
  expect(
    spaceDisplayName({ ...space, type: "team", name: "Team" }, () => "Personal", "viewer"),
  ).toBe("Team");
});
