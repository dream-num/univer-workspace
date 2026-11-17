import { expect, it } from "vitest";
import { remapIds, uuidsIn } from "../../server/src/modules/copies/unit-id-remap.js";

const unit = "11111111-1111-4111-8111-111111111111";
const asset = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const bytes = new Uint8Array([1, 2, 3]);
const untouched = `{ "note": "spacing kept", "id": "${other}" }`;
const data = {
  id: unit,
  resources: [
    { name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ sheet: { [asset]: { unitId: unit, source: asset } } }) },
    { name: "SHEET_FILTER_PLUGIN", data: untouched },
    { name: "EMPTY", data: "" },
  ],
  drawings: { [asset]: { source: asset, title: other } },
  cells: [1, null, true, "plain", bytes, `see ${unit} for details`, `${asset}.png`, unit],
};

it("finds whole IDs in values, keys and JSON kept as text, not IDs inside longer text", () => {
  expect(uuidsIn(data)).toEqual(new Set([unit, asset, other]));
  expect(uuidsIn({ cell: `see ${other} for details` })).toEqual(new Set());
});

it("replaces only values and keys equal to a mapped ID and leaves the source data, other text and bytes alone", () => {
  const copy = remapIds(data, new Map([[unit, "new-unit"], [asset, "new-asset"]]));
  expect(copy).toEqual({
    id: "new-unit",
    resources: [
      { name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ sheet: { "new-asset": { unitId: "new-unit", source: "new-asset" } } }) },
      { name: "SHEET_FILTER_PLUGIN", data: untouched },
      { name: "EMPTY", data: "" },
    ],
    drawings: { "new-asset": { source: "new-asset", title: other } },
    cells: [1, null, true, "plain", bytes, `see ${unit} for details`, `${asset}.png`, "new-unit"],
  });
  expect(copy.cells[4]).toBe(bytes);
  expect(data.id).toBe(unit);
});
