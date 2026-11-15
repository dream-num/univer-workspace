import { afterEach, beforeEach, expect, it } from "vitest";
import { SqliteDatabase } from "../connection.js";
import { createSqliteRepositories } from "../open.js";
import type { SpacePinsRepository } from "../../../modules/spaces/space-pins.repository.js";

let database: SqliteDatabase;
let pins: SpacePinsRepository;
beforeEach(() => {
  database = new SqliteDatabase(":memory:");
  const repositories = createSqliteRepositories(database);
  database.connection.exec(`
    INSERT INTO users (id, username, display_name, created_at, updated_at)
    VALUES ('owner', 'owner', 'Owner', 1, 1)
  `);
  for (const id of ["alpha", "beta", "gamma"]) {
    repositories.spaces.createTeamSpace({
      id, name: id, slug: id, publicRead: false, ownerUserId: "owner", createdAt: 1,
    });
  }
  pins = repositories.spacePins;
});
afterEach(() => database.close());

it("returns the ordered pins from each writer's own replacement", async () => {
  const replacements = [["beta", "alpha"], ["gamma", "beta"]];
  const results = await Promise.all(replacements.map((ids) => pins.replacePins("owner", ids, 1)));
  expect(results.map((result) => result?.spaces.map((space) => space.id))).toEqual(replacements);
  const stored = await pins.getPins("owner", 8);
  expect(replacements).toContainEqual(stored.spaces.map((space) => space.id));
});

it("restores all previous positions if a replacement fails after its first insert", async () => {
  const before = await pins.replacePins("owner", ["beta", "alpha"], 1);
  database.connection.exec(`
    CREATE TRIGGER reject_second_pin BEFORE INSERT ON space_pins WHEN NEW.position = 1
    BEGIN SELECT RAISE(ABORT, 'second pin failed'); END;
  `);
  await expect(pins.replacePins("owner", ["alpha", "gamma"], 2)).rejects.toThrow("second pin failed");
  expect(await pins.getPins("owner", 8)).toEqual(before);
});
