import { afterEach, beforeEach, expect, it } from "vitest";
import { SqliteDatabase } from "../connection.js";
import { SqliteSpacesRepository } from "./spaces.repository.js";

let database: SqliteDatabase;
let spaces: SqliteSpacesRepository;
beforeEach(async () => {
  database = new SqliteDatabase(":memory:");
  spaces = new SqliteSpacesRepository(database);
  database.connection.exec(`
    INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES
      ('owner', 'owner', 'Owner', 1, 1), ('reader', 'reader', 'Reader', 1, 1)
  `);
  await spaces.createTeamSpace({ id: "team", name: "Team", slug: "team", publicRead: false, proposals: "members", ownerUserId: "owner", createdAt: 1 });
});
afterEach(() => database.close());

it("rolls back all settings and the timestamp if the update fails", async () => {
  database.connection.exec(`
    CREATE TRIGGER fail_description AFTER UPDATE OF description ON spaces
    BEGIN SELECT RAISE(FAIL, 'description failed'); END
  `);
  await expect(spaces.updateSettings("owner", "team", { name: "New", description: "New", slug: "new", publicRead: true }, 2, () => {}))
    .rejects.toThrow("description failed");
  const row = database.connection.prepare("SELECT name, description, slug, public_read, updated_at FROM spaces WHERE id = 'team'").get();
  expect(row).toEqual({ name: "Team", description: "", slug: "team", public_read: 0, updated_at: 1 });

  // A patch which omits the description must not fire UPDATE OF description.
  expect(await spaces.updateSettings("owner", "team", { name: "New" }, 3, () => {})).toMatchObject({ name: "New", slug: "team" });
});

it("rechecks the actor's current access before writing settings", async () => {
  database.connection.exec(`
    INSERT INTO space_members (space_id, user_id, role, granted_by, created_at, updated_at)
    VALUES ('team', 'reader', 'admin', 'owner', 1, 1)
  `);
  expect(await spaces.getView("reader", "team")).toMatchObject({ memberRole: "admin" });
  database.connection.exec("UPDATE space_members SET role = 'viewer' WHERE user_id = 'reader'");
  await expect(spaces.updateSettings("reader", "team", { name: "Denied" }, 2, () => {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  database.connection.exec("DELETE FROM space_members WHERE user_id = 'reader'");
  await expect(spaces.updateSettings("reader", "team", { name: "Denied" }, 3, () => {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await spaces.getView("owner", "team")).toMatchObject({ name: "Team" });
});
