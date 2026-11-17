import { expect, it } from "vitest";
import { remapIds, uuidsIn } from "../../server/src/modules/copies/unit-id-remap.js";

const unit = "11111111-1111-4111-8111-111111111111";
const asset = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const bytes = new Uint8Array([1, 2, 3]);
const data = {
  id: unit,
  resources: [{ name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ sheet: { [asset]: { unitId: unit, source: asset } } }) }],
  drawings: { [asset]: { source: asset, title: other } },
  cells: [1, null, true, "plain", bytes],
};

it("finds IDs in values, keys and JSON kept as text", () => {
  expect(uuidsIn(data)).toEqual(new Set([unit, asset, other]));
});

it("replaces only mapped IDs and leaves the source data and bytes alone", () => {
  const copy = remapIds(data, new Map([[unit, "new-unit"], [asset, "new-asset"]]));
  expect(copy).toEqual({
    id: "new-unit",
    resources: [{ name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ sheet: { "new-asset": { unitId: "new-unit", source: "new-asset" } } }) }],
    drawings: { "new-asset": { source: "new-asset", title: other } },
    cells: [1, null, true, "plain", bytes],
  });
  expect(copy.cells[4]).toBe(bytes);
  expect(data.id).toBe(unit);
});
