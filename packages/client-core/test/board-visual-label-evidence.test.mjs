import { describe, expect, it } from "vitest";
import { recordConnectorLabelEvidence } from "../scripts/board-visual-label-evidence.mjs";

const ready = (extra = {}) => ({
  status: "ready",
  rect: { left: 0, top: 0, width: 20, height: 10 },
  bounds: { left: 0, top: 0, width: 20, height: 10 },
  angleRadians: 0,
  outerSize: { width: 20, height: 10 },
  requiredSize: { width: 16, height: 6 },
  empty: false,
  overflow: false,
  endpointConstrained: false,
  ...extra,
});
const route = (
  points = [
    { x: -10, y: 20 },
    { x: 30, y: 20 },
  ],
) => ({
  connectorId: "edge",
  resolved: true,
  points,
});
const analysis = (label = ready(), points) => ({
  source: "rendered",
  routes: [route(points)],
  issues: [],
  connectorLabelLayouts: { edge: { label } },
});
const measure = (points, label = ready()) =>
  recordConnectorLabelEvidence(analysis(label, points), "page").entries[0];

describe("Native connector label polyline evidence", () => {
  it.each([
    {
      points: [
        { x: -10, y: 20 },
        { x: 30, y: 20 },
      ],
      distance: 10,
    },
    {
      points: [
        { x: 30, y: -10 },
        { x: 30, y: 20 },
      ],
      distance: 10,
    },
    {
      points: [
        { x: 23, y: 14 },
        { x: 26, y: 18 },
      ],
      distance: 5,
    },
    {
      points: [
        { x: -10, y: 5 },
        { x: 30, y: 5 },
      ],
      distance: 0,
    },
    {
      points: [
        { x: 2, y: 2 },
        { x: 18, y: 8 },
      ],
      distance: 0,
    },
    {
      points: [
        { x: -10, y: 30 },
        { x: 30, y: 30 },
        { x: 30, y: 5 },
        { x: 25, y: 5 },
      ],
      distance: 5,
    },
    {
      points: [
        { x: -10, y: 20 },
        { x: -10, y: 20 },
        { x: 30, y: 20 },
      ],
      distance: 10,
    },
  ])("measures finite polyline segments ($distance Board units)", ({ points, distance }) => {
    expect(measure(points)).toMatchObject({
      status: "measured",
      distanceToResolvedPolyline: distance,
    });
  });

  it("uses radians and the unrotated rect instead of its world AABB", () => {
    expect(
      measure(
        [
          { x: 20, y: -50 },
          { x: 20, y: 50 },
        ],
        ready({
          angleRadians: Math.PI / 2,
          bounds: { left: 5, top: -5, width: 10, height: 20 },
        }),
      ).distanceToResolvedPolyline,
    ).toBeCloseTo(5, 10);
    const label = ready({
      rect: { left: 0, top: 0, width: 20, height: 2 },
      outerSize: { width: 20, height: 2 },
      requiredSize: { width: 16, height: 2 },
      angleRadians: Math.PI / 4,
      bounds: {
        left: 10 - 11 / Math.sqrt(2),
        top: 1 - 11 / Math.sqrt(2),
        width: 22 / Math.sqrt(2),
        height: 22 / Math.sqrt(2),
      },
    });
    expect(
      measure(
        [
          { x: 3, y: 7 },
          { x: 4, y: 7 },
        ],
        label,
      ).distanceToResolvedPolyline,
    ).toBeCloseTo(6 * Math.sqrt(2) - 1, 10);
  });

  it("preserves distance under a common rotation and translation", () => {
    const angle = -1.234,
      width = 20 * Math.abs(Math.cos(angle)) + 10 * Math.abs(Math.sin(angle)),
      height = 20 * Math.abs(Math.sin(angle)) + 10 * Math.abs(Math.cos(angle)),
      label = ready({
        rect: { left: 100, top: -70, width: 20, height: 10 },
        bounds: { left: 110 - width / 2, top: -65 - height / 2, width, height },
        angleRadians: angle,
      });
    const points = [
      { x: -10, y: 20 },
      { x: 30, y: 20 },
    ].map(({ x, y }) => ({
      x: 110 + (x - 10) * Math.cos(angle) - (y - 5) * Math.sin(angle),
      y: -65 + (x - 10) * Math.sin(angle) + (y - 5) * Math.cos(angle),
    }));
    expect(measure(points, label).distanceToResolvedPolyline).toBeCloseTo(10, 10);
  });

  it("measures empty native frames and preserves independent flags and raw evidence", () => {
    const value = analysis(
      ready({
        empty: true,
        overflow: true,
        endpointConstrained: true,
        rect: { left: 0, top: 10, width: 20, height: 10 },
        bounds: { left: 0, top: 10, width: 20, height: 10 },
      }),
      [
        { x: -10, y: 0 },
        { x: 30, y: 0 },
      ],
    );
    value.issues.push({ bounds: { left: -500, top: -500, width: 1000, height: 1000 } });
    const before = structuredClone(value),
      result = recordConnectorLabelEvidence(value, "page");
    expect(result.entries[0].distanceToResolvedPolyline).toBe(10);
    expect(result.native).toEqual({
      connectorLabelLayouts: value.connectorLabelLayouts,
      routes: value.routes,
    });
    expect(value).toEqual(before);
    expect(result).toMatchObject({
      status: "measured",
      coverage: { independentSameStateLabelIds: { status: "incomplete" } },
      finalPaintDistance: "unmeasured",
      placement: "unavailable-without-same-state-native-snapshot",
      visualApproval: "pending",
    });
  });

  it("retains zero native sizes without treating empty as zero distance", () => {
    const label = ready({
      empty: true,
      rect: { left: 5, top: 7, width: 0, height: 0 },
      bounds: { left: 5, top: 7, width: 0, height: 0 },
      outerSize: { width: 0, height: 0 },
      requiredSize: { width: 0, height: 0 },
    });
    expect(
      measure(
        [
          { x: -10, y: 0 },
          { x: 30, y: 0 },
        ],
        label,
      ).distanceToResolvedPolyline,
    ).toBe(7);
  });

  it("separates measured geometry from unavailable independent same-state ID coverage", () => {
    const result = recordConnectorLabelEvidence(analysis(), "page");
    expect(result.coverage).toEqual({
      geometry: { complete: true, incomplete: [] },
      nativeMapScope: "all-visible-connector-labels-by-native-contract",
      independentSameStateLabelIds: {
        status: "incomplete",
        detail: "same-state-label-id-inventory-unavailable",
      },
      reportedLabelCount: 1,
      measuredLabelCount: 1,
    });
    expect(result.status).toBe("measured");
    expect(result.problems).toEqual([]);
  });

  it.each([undefined, null, false, []].map((map) => ({ map })))(
    "preserves missing or malformed measurement maps ($map) as incomplete",
    ({ map }) => {
      const value = { ...analysis(), connectorLabelLayouts: map },
        result = recordConnectorLabelEvidence(value, "page");
      expect(result.entries).toEqual([]);
      expect(result.coverage).toMatchObject({
        geometry: { complete: false },
        reportedLabelCount: null,
        measuredLabelCount: 0,
      });
      expect(result.native.connectorLabelLayouts).toBe(map);
    },
  );

  it("records an empty native map by contract without inventing a distance or visual pass", () => {
    const result = recordConnectorLabelEvidence(
      { source: "rendered", routes: [], issues: [], connectorLabelLayouts: {} },
      "page",
    );
    expect(result).toMatchObject({
      status: "measured",
      entries: [],
      coverage: {
        geometry: { complete: true, incomplete: [] },
        independentSameStateLabelIds: { status: "incomplete" },
        reportedLabelCount: 0,
        measuredLabelCount: 0,
      },
      visualApproval: "pending",
    });
  });

  it("retains unresolved entries and deduplicates the existing coverage category", () => {
    const value = analysis({ status: "unresolved" });
    value.connectorLabelLayouts.edge.second = { status: "unresolved" };
    value.issues.push({ rule: "connector-label-layout-unresolved" });
    const result = recordConnectorLabelEvidence(value, "page");
    expect(result.entries).toHaveLength(2);
    expect(result.entries.every((entry) => entry.status === "incomplete")).toBe(true);
    expect(result.coverage.geometry.incomplete).toEqual([
      { pageId: "page", source: "rendered", reason: "unresolved-label" },
    ]);
    expect(result.native.connectorLabelLayouts).toEqual(value.connectorLabelLayouts);
  });

  it("detects mismatched native map and visible route IDs without authored input IDs", () => {
    const value = analysis();
    value.routes[0].connectorId = "other";
    const result = recordConnectorLabelEvidence(value, "page");
    expect(result.entries[0]).not.toHaveProperty("distanceToResolvedPolyline");
    expect(result.coverage.geometry.incomplete.map((item) => item.reason)).toEqual([
      "unresolved-route",
      "unresolved-label",
    ]);
    expect(result.problems).toContainEqual({
      reason: "unresolved-label",
      detail: "visible-route-label-record-missing",
      connectorId: "other",
    });
  });

  it.each([
    { points: [] },
    { points: [{ x: 0, y: 0 }] },
    {
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    },
    {
      points: [
        { x: 0, y: 0 },
        { x: Infinity, y: 0 },
      ],
    },
    {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      resolved: false,
    },
  ])("rejects insufficient or unresolved route geometry ($points)", (extra) => {
    const value = analysis();
    Object.assign(value.routes[0], extra);
    const result = recordConnectorLabelEvidence(value, "page");
    expect(result.entries[0]).toEqual({
      connectorId: "edge",
      labelId: "label",
      status: "incomplete",
    });
    expect(result.coverage.geometry.incomplete).toContainEqual({
      pageId: "page",
      source: "rendered",
      reason: "unresolved-route",
    });
  });

  it("rejects duplicate route identities and an absent route array", () => {
    const value = analysis();
    value.routes.push(route());
    expect(recordConnectorLabelEvidence(value, "page").entries[0].status).toBe("incomplete");
    delete value.routes;
    const result = recordConnectorLabelEvidence(value, "page");
    expect(result.problems).toContainEqual({
      reason: "unresolved-route",
      detail: "native-route-geometry-unavailable",
    });
  });

  it("retains finite native values whose derived distance cannot be represented", () => {
    const label = ready({
      rect: { left: 0, top: 1e307, width: 20, height: 10 },
      bounds: { left: 0, top: 1e307, width: 20, height: 10 },
    });
    expect(
      measure(
        [
          { x: -1e308, y: -1e308 },
          { x: 1e308, y: 1e308 },
        ],
        label,
      ),
    ).toEqual({ connectorId: "edge", labelId: "label", status: "incomplete" });
  });

  it.each([
    { status: "unknown" },
    { angleRadians: NaN },
    { rect: { left: 0, top: 0, width: -1, height: 10 } },
    { bounds: undefined },
    { outerSize: { width: Infinity, height: 10 } },
    { requiredSize: { width: 10, height: -1 } },
    { empty: "false" },
  ])("does not convert invalid native measurements to ready ($status)", (extra) => {
    expect(measure(undefined, ready(extra))).toEqual({
      connectorId: "edge",
      labelId: "label",
      status: "incomplete",
    });
  });
});

describe("Opt-in native automatic label-distance evidence", () => {
  const receipt = { maximumAutomaticLabelDistance: 12, metric: "rendered-stroke-polyline-v1" };
  it("keeps native 24/48 distances distinct from the legacy raw-polyline metric", () => {
    const value = analysis(ready({ automaticLabelDistance: { status: "ready", distance: 24 } }), [
      { x: -10, y: 5 },
      { x: 30, y: 5 },
    ]);
    value.connectorLabelLayouts.edge.second = ready({
      automaticLabelDistance: { status: "ready", distance: 48 },
    });
    value.labelDistanceInspection = receipt;
    value.issues = ["label", "second"].map((labelId) => ({
      rule: "connector-label-distance-exceeded",
      connectorIds: ["edge"],
      labelIds: [labelId],
    }));
    const before = structuredClone(value);
    const result = recordConnectorLabelEvidence(value, "page", {
      maximumAutomaticLabelDistance: 12,
    });
    expect(result.entries.map((entry) => entry.distanceToResolvedPolyline)).toEqual([0, 0]);
    expect(result.nativeAutomaticLabelDistance).toMatchObject({
      status: "findings",
      receipt,
      entries: [
        { connectorId: "edge", labelId: "label", status: "ready", distance: 24 },
        { connectorId: "edge", labelId: "second", status: "ready", distance: 48 },
      ],
      finalPaintDistance: "unmeasured",
      visualApproval: "pending",
    });
    expect(result.finalPaintDistance).toBe("unmeasured");
    expect(result.native.connectorLabelLayouts).toEqual(value.connectorLabelLayouts);
    expect(value).toEqual(before);
  });
  it.each([
    "old-producer",
    "missing-map",
    "missing-metric",
    "unresolved",
    "outer-unresolved",
    "wrong-metric",
    "wrong-threshold",
    "invalid-distance",
    "invalid-route",
    "missing-connector-record",
    "contradictory-empty",
  ])("keeps requested %s evidence incomplete", (kind) => {
    const value = analysis(ready({ automaticLabelDistance: { status: "ready", distance: 12 } }));
    if (kind !== "old-producer") value.labelDistanceInspection = { ...receipt };
    if (kind === "missing-map") delete value.connectorLabelLayouts;
    if (kind === "missing-metric")
      delete value.connectorLabelLayouts.edge.label.automaticLabelDistance;
    if (kind === "unresolved")
      value.connectorLabelLayouts.edge.label.automaticLabelDistance = { status: "unresolved" };
    if (kind === "outer-unresolved")
      value.connectorLabelLayouts.edge.label = { status: "unresolved" };
    if (kind === "wrong-metric") value.labelDistanceInspection.metric = "raster-ink";
    if (kind === "wrong-threshold") value.labelDistanceInspection.maximumAutomaticLabelDistance = 0;
    if (kind === "invalid-distance")
      value.connectorLabelLayouts.edge.label.automaticLabelDistance.distance = Infinity;
    if (kind === "invalid-route") value.routes = [null];
    if (kind === "missing-connector-record") value.connectorLabelLayouts = {};
    if (kind === "contradictory-empty") value.connectorLabelLayouts.edge.label.empty = true;
    expect(
      recordConnectorLabelEvidence(value, "page", { maximumAutomaticLabelDistance: 12 })
        .nativeAutomaticLabelDistance.status,
    ).toBe("incomplete");
  });
  it("accepts a supported empty inspection and native authored/role exclusions without claiming visual approval", () => {
    expect(
      recordConnectorLabelEvidence(
        {
          source: "rendered",
          routes: [],
          issues: [],
          connectorLabelLayouts: {},
          labelDistanceInspection: receipt,
        },
        "page",
        { maximumAutomaticLabelDistance: 12 },
      ).nativeAutomaticLabelDistance,
    ).toMatchObject({
      status: "measured",
      entries: [],
      coverage: { complete: true },
      visualApproval: "pending",
    });
    const value = analysis(
      ready({ automaticLabelDistance: { status: "excluded", reason: "authored-placement" } }),
    );
    value.labelDistanceInspection = receipt;
    value.connectorLabelLayouts.edge.role = ready({
      automaticLabelDistance: { status: "excluded", reason: "endpoint-role" },
    });
    expect(
      recordConnectorLabelEvidence(value, "page", { maximumAutomaticLabelDistance: 12 })
        .nativeAutomaticLabelDistance,
    ).toMatchObject({
      status: "measured",
      entries: [
        { status: "excluded", reason: "authored-placement" },
        { status: "excluded", reason: "endpoint-role" },
      ],
    });
  });
});
