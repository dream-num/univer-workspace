import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoryChangesetsBody,
  buildHistoryCreatorsBody,
  buildHistoryListBody,
  extractCommands,
  parsePositiveInt
} from "../src/integrations/univer-history.ts";

describe("Univer history protocol helpers", () => {
  test("parses positive integers and page size fallback", () => {
    assert.equal(parsePositiveInt(null, 20), 20);
    assert.equal(parsePositiveInt("", 20), 20);
    assert.equal(parsePositiveInt("20"), 20);
    assert.equal(parsePositiveInt("0"), null);
    assert.equal(parsePositiveInt("nope"), null);
  });

  test("lists history from unit creation and grouped changesets", () => {
    const unit = { unitId: "unit_sheet", rev: 3, createdAt: 1_000 };
    const entries = [
      {
        id: "cs_2",
        rev: 2,
        clientId: "user_admin",
        createdAt: 2_000,
        changeset: { mutations: [{ id: "sheet.mutation.set-range-values" }] }
      },
      {
        id: "cs_3",
        rev: 3,
        clientId: "user_admin",
        createdAt: 2_500,
        changeset: { mutations: [{ id: "sheet.mutation.set-range-values" }] }
      }
    ];

    const body = buildHistoryListBody("unit_sheet", unit, entries, { length: 20 }) as any;
    assert.equal(body.error.code, 1);
    assert.equal(body.hasMore, false);
    assert.equal(body.historyIds.length, 2);
    assert.equal(body.entities.datas[body.historyIds[0]].endRevision, 3);
    assert.equal(body.entities.datas[body.historyIds[0]].startRevision, 2);
    assert.equal(body.entities.datas[body.historyIds[1]].startRevision, 1);
    assert.equal(body.entities.users.user_admin.name, "Administrator");
  });

  test("paginates with lastLabel and lists creators", () => {
    const unit = { unitId: "unit_sheet", rev: 1, createdAt: 1_000 };
    const body = buildHistoryListBody("unit_sheet", unit, [], { length: 20 }) as any;
    assert.deepEqual(body.historyIds, ["history_unit_sheet_1_1"]);

    const page = buildHistoryListBody("unit_sheet", unit, [], {
      length: 20,
      lastLabel: "1"
    }) as any;
    assert.deepEqual(page.historyIds, []);

    const creators = buildHistoryCreatorsBody(unit, []) as any;
    assert.equal(creators.error.code, 1);
    assert.equal(creators.creators[0].userId, "user_admin");
  });

  test("returns changeset range for history details", () => {
    const entries = [
      {
        id: "cs_2",
        rev: 2,
        clientId: "member_1",
        createdAt: 2_000,
        changeset: { revision: 2, mutations: [{ id: "m1" }] }
      }
    ];
    const body = buildHistoryChangesetsBody("unit_sheet", entries, 2, 2) as any;
    assert.equal(body.error.code, 1);
    assert.equal(body.changesets.length, 1);
    assert.equal(body.changesets[0].revision, 2);
    assert.equal(body.changesets[0].userID, "member_1");
    assert.deepEqual(extractCommands(entries[0].changeset), ["m1"]);
  });
});
