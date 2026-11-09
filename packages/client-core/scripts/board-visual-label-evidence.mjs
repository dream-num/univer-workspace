function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRect(rect) {
  return (
    isRecord(rect) &&
    [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}

function isReadyMeasurement(label) {
  return (
    isRecord(label) &&
    label.status === "ready" &&
    isRect(label.rect) &&
    isRect(label.bounds) &&
    Number.isFinite(label.angleRadians) &&
    [label.outerSize, label.requiredSize].every(
      (size) =>
        isRecord(size) &&
        [size.width, size.height].every((value) => Number.isFinite(value) && value >= 0),
    ) &&
    [label.empty, label.overflow, label.endpointConstrained].every(
      (value) => typeof value === "boolean",
    )
  );
}

function pointToSegment(point, start, end) {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const along = Math.max(
    0,
    Math.min(length, (point.x - start.x) * (dx / length) + (point.y - start.y) * (dy / length)),
  );
  return Math.hypot(
    point.x - start.x - along * (dx / length),
    point.y - start.y - along * (dy / length),
  );
}

function segmentToRect(start, end, rect) {
  const right = rect.left + rect.width,
    bottom = rect.top + rect.height;
  let from = 0,
    to = 1;
  for (const [origin, delta, low, high] of [
    [start.x, end.x - start.x, rect.left, right],
    [start.y, end.y - start.y, rect.top, bottom],
  ]) {
    if (delta === 0) {
      if (origin < low || origin > high) {
        from = 1;
        to = 0;
      }
    } else {
      const a = (low - origin) / delta,
        b = (high - origin) / delta;
      from = Math.max(from, Math.min(a, b));
      to = Math.min(to, Math.max(a, b));
    }
  }
  if (from <= to) return 0;
  const pointToRect = (point) =>
    Math.hypot(
      Math.max(rect.left - point.x, 0, point.x - right),
      Math.max(rect.top - point.y, 0, point.y - bottom),
    );
  return Math.min(
    pointToRect(start),
    pointToRect(end),
    ...[
      { x: rect.left, y: rect.top },
      { x: right, y: rect.top },
      { x: right, y: bottom },
      { x: rect.left, y: bottom },
    ].map((corner) => pointToSegment(corner, start, end)),
  );
}

function distanceToResolvedPolyline(label, points) {
  const centerX = label.rect.left + label.rect.width / 2,
    centerY = label.rect.top + label.rect.height / 2,
    cosine = Math.cos(label.angleRadians),
    sine = Math.sin(label.angleRadians);
  if (
    ![label.rect.left + label.rect.width, label.rect.top + label.rect.height].every(Number.isFinite)
  )
    return undefined;
  const local = points.map(({ x, y }) => ({
    x: centerX + (x - centerX) * cosine + (y - centerY) * sine,
    y: centerY - (x - centerX) * sine + (y - centerY) * cosine,
  }));
  if (!local.every((point) => [point.x, point.y].every(Number.isFinite))) return undefined;
  let distance = Infinity;
  for (let index = 1; index < local.length; index++) {
    const start = local[index - 1],
      end = local[index];
    if (!Number.isFinite(Math.hypot(end.x - start.x, end.y - start.y))) return undefined;
    distance = Math.min(distance, segmentToRect(start, end, label.rect));
  }
  return Number.isFinite(distance) ? distance : undefined;
}

/** QA only: measure the supplied native route polyline, without planning or editing content. */
export function recordConnectorLabelEvidence(analysis, pageId, options = {}) {
  const problems = [],
    reasons = new Set(),
    entries = [];
  const problem = (reason, detail, identity = {}) => {
    reasons.add(reason);
    problems.push({ reason, detail, ...identity });
  };
  if (analysis?.source !== "rendered" || typeof pageId !== "string" || pageId.trim() === "")
    problem("analysis-missing", "rendered-page-identity-unavailable");
  const layouts = analysis?.connectorLabelLayouts,
    routes = new Map();
  if (!Array.isArray(analysis?.routes))
    problem("unresolved-route", "native-route-geometry-unavailable");
  for (const route of Array.isArray(analysis?.routes) ? analysis.routes : []) {
    if (
      !isRecord(route) ||
      typeof route.connectorId !== "string" ||
      route.connectorId.trim() === ""
    ) {
      problem("unresolved-route", "invalid-route-identity");
      continue;
    }
    const previous = routes.get(route.connectorId);
    if (previous !== undefined)
      problem("unresolved-route", "duplicate-native-route-identity", {
        connectorId: route.connectorId,
      });
    routes.set(route.connectorId, previous === undefined ? [route] : [...previous, route]);
  }
  const validMap = isRecord(layouts);
  if (!validMap) problem("unresolved-label", "native-label-measurement-map-unavailable");
  let reportedLabelCount = 0;
  for (const [connectorId, labels] of validMap ? Object.entries(layouts) : []) {
    const identity = { connectorId },
      candidates = routes.get(connectorId),
      route = candidates?.length === 1 ? candidates[0] : undefined;
    const validRoute =
      route?.resolved === true &&
      Array.isArray(route.points) &&
      route.points.length >= 2 &&
      route.points.every((point) => isRecord(point) && [point.x, point.y].every(Number.isFinite)) &&
      route.points.some(
        (point, index) =>
          index > 0 &&
          (point.x !== route.points[index - 1].x || point.y !== route.points[index - 1].y),
      );
    if (!validRoute) problem("unresolved-route", "unique-resolved-polyline-unavailable", identity);
    if (connectorId.trim() === "" || !isRecord(labels)) {
      problem("unresolved-label", "invalid-native-label-record", identity);
      continue;
    }
    for (const [labelId, label] of Object.entries(labels)) {
      reportedLabelCount++;
      const entry = { connectorId, labelId, status: "incomplete" };
      entries.push(entry);
      if (labelId.trim() === "" || !isReadyMeasurement(label)) {
        problem("unresolved-label", "native-label-measurement-unresolved-or-invalid", {
          connectorId,
          labelId,
        });
        continue;
      }
      if (!validRoute) continue;
      const distance = distanceToResolvedPolyline(label, route.points);
      if (distance === undefined) {
        problem("unresolved-label", "label-route-distance-unmeasurable", { connectorId, labelId });
        continue;
      }
      entry.status = "measured";
      entry.distanceToResolvedPolyline = distance;
    }
  }
  for (const connectorId of routes.keys())
    if (validMap && !Object.hasOwn(layouts, connectorId))
      problem("unresolved-label", "visible-route-label-record-missing", { connectorId });
  const maximum = options.maximumAutomaticLabelDistance;
  const nativeAutomaticLabelDistance =
    maximum !== undefined || analysis?.labelDistanceInspection !== undefined
      ? recordNativeAutomaticLabelDistance(analysis, maximum)
      : undefined;
  return {
    ...(nativeAutomaticLabelDistance === undefined ? {} : { nativeAutomaticLabelDistance }),
    status: reasons.size ? "incomplete" : "measured",
    metric: "distanceToResolvedPolyline",
    units: "board",
    native: {
      ...(layouts === undefined ? {} : { connectorLabelLayouts: layouts }),
      routes: analysis?.routes,
      ...(analysis?.labelDistanceInspection === undefined
        ? {}
        : { labelDistanceInspection: analysis.labelDistanceInspection }),
    },
    entries,
    problems,
    coverage: {
      geometry: {
        complete: reasons.size === 0,
        incomplete: [...reasons].map((reason) => ({
          ...(pageId === undefined ? {} : { pageId }),
          source: "rendered",
          reason,
        })),
      },
      nativeMapScope: validMap ? "all-visible-connector-labels-by-native-contract" : "unavailable",
      // ScreenshotImage has no post-load snapshot; input IDs cannot independently prove native IDs.
      independentSameStateLabelIds: {
        status: "incomplete",
        detail: "same-state-label-id-inventory-unavailable",
      },
      reportedLabelCount: validMap ? reportedLabelCount : null,
      measuredLabelCount: entries.filter((entry) => entry.status === "measured").length,
    },
    finalPaintDistance: "unmeasured",
    placement: "unavailable-without-same-state-native-snapshot",
    visualApproval: "pending",
  };
}

function recordNativeAutomaticLabelDistance(analysis, maximum) {
  const receipt = analysis?.labelDistanceInspection;
  const entries = [],
    problems = [];
  const issue = (detail, identity = {}) => problems.push({ detail, ...identity });
  if (analysis?.source !== "rendered") issue("rendered-analysis-unavailable");
  if (
    !isRecord(receipt) ||
    receipt.metric !== "rendered-stroke-polyline-v1" ||
    !Number.isFinite(receipt.maximumAutomaticLabelDistance) ||
    receipt.maximumAutomaticLabelDistance < 0 ||
    (maximum !== undefined && receipt.maximumAutomaticLabelDistance !== maximum)
  )
    issue("native-distance-receipt-unavailable-or-mismatched");
  const limit = maximum ?? receipt?.maximumAutomaticLabelDistance;
  const layouts = analysis?.connectorLabelLayouts;
  if (!isRecord(layouts)) issue("native-label-measurement-map-unavailable");
  for (const route of Array.isArray(analysis?.routes) ? analysis.routes : []) {
    if (!isRecord(route) || typeof route.connectorId !== "string") {
      issue("invalid-native-route-identity");
      continue;
    }
    if (isRecord(layouts) && !Object.hasOwn(layouts, route.connectorId))
      issue("visible-native-label-record-missing", { connectorId: route.connectorId });
  }
  for (const [connectorId, labels] of isRecord(layouts) ? Object.entries(layouts) : []) {
    if (connectorId.trim() === "" || !isRecord(labels)) {
      issue("invalid-native-label-record", { connectorId });
      continue;
    }
    for (const [labelId, label] of Object.entries(labels)) {
      const identity = { connectorId, labelId };
      if (labelId.trim() === "") issue("invalid-native-label-identity", identity);
      const metric = label?.status === "ready" ? label.automaticLabelDistance : undefined;
      entries.push({
        ...identity,
        ...(metric === undefined ? { status: "unresolved" } : { ...metric }),
      });
      if (!isReadyMeasurement(label) || !isRecord(metric)) {
        issue("native-distance-unavailable", identity);
        continue;
      }
      if (metric.status === "ready" && Number.isFinite(metric.distance) && metric.distance >= 0) {
        if (label.empty) issue("contradictory-empty-distance", identity);
        if (
          metric.distance > limit + 0.001 &&
          !analysis.issues?.some(
            (finding) =>
              finding.rule === "connector-label-distance-exceeded" &&
              finding.connectorIds?.includes(connectorId) &&
              finding.labelIds?.includes(labelId),
          )
        ) {
          issue("native-distance-finding-missing", identity);
        }
      } else if (
        metric.status === "excluded" &&
        ["empty", "authored-placement", "endpoint-role"].includes(metric.reason)
      ) {
        if ((metric.reason === "empty") !== label.empty)
          issue("contradictory-empty-exclusion", identity);
      } else issue("native-distance-unresolved-or-invalid", identity);
    }
  }
  const exceeded = analysis?.issues?.some(
    (finding) => finding.rule === "connector-label-distance-exceeded",
  );
  return {
    source: "native-rendered-analysis",
    status: problems.length ? "incomplete" : exceeded ? "findings" : "measured",
    ...(maximum === undefined ? {} : { requestedMaximumAutomaticLabelDistance: maximum }),
    ...(receipt === undefined ? {} : { receipt }),
    entries,
    problems,
    coverage: { complete: problems.length === 0 },
    qualification:
      "Native sampled, marker-trimmed stroke centerline before dash gaps and label clipping; curves use the native bounded polyline approximation. Not raster ink.",
    finalPaintDistance: "unmeasured",
    visualApproval: "pending",
  };
}
