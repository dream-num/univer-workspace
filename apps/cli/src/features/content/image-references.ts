export type WorkspaceImageSourceType = "BASE64" | "UUID";

export interface WorkspaceImageReference {
  readonly source: string;
}

interface WorkspaceImageFieldPair extends WorkspaceImageReference {
  readonly sourceKey: string;
  readonly typeKey: string;
}

interface RewriteResult {
  readonly changed: boolean;
  readonly value: unknown;
}

export function visitWorkspaceImageReferences(
  value: unknown,
  sourceType: WorkspaceImageSourceType,
  visit: (reference: WorkspaceImageReference) => void,
): void {
  visitRecords(value, sourceType, visit);
}

export function rewriteWorkspaceImageReferences(
  value: unknown,
  sourceType: WorkspaceImageSourceType,
  replacementType: WorkspaceImageSourceType,
  replacementBySource: ReadonlyMap<string, string>,
): unknown {
  return rewriteValue(value, sourceType, replacementType, replacementBySource).value;
}

function rewriteValue(
  value: unknown,
  sourceType: WorkspaceImageSourceType,
  replacementType: WorkspaceImageSourceType,
  replacementBySource: ReadonlyMap<string, string>,
): RewriteResult {
  if (Array.isArray(value)) {
    let changed = false;
    const rewritten = value.map((item) => {
      const result = rewriteValue(item, sourceType, replacementType, replacementBySource);
      changed ||= result.changed;
      return result.value;
    });
    return changed ? { changed: true, value: rewritten } : { changed: false, value };
  }
  if (!isRecord(value)) return { changed: false, value };

  let changed = false;
  const rewritten: Record<string, unknown> = { ...value };
  for (const [key, child] of Object.entries(value)) {
    const result =
      key === "resources"
        ? rewriteSerializedResources(child, sourceType, replacementType, replacementBySource)
        : rewriteValue(child, sourceType, replacementType, replacementBySource);
    if (result.changed) {
      changed = true;
      rewritten[key] = result.value;
    }
  }
  for (const reference of imageFieldPairs(value, sourceType)) {
    const replacement = replacementBySource.get(reference.source);
    if (replacement !== undefined) {
      changed = true;
      rewritten[reference.sourceKey] = replacement;
      rewritten[reference.typeKey] = replacementType;
    }
  }
  return changed ? { changed: true, value: rewritten } : { changed: false, value };
}

function imageFieldPairs(
  record: Readonly<Record<string, unknown>>,
  sourceType: WorkspaceImageSourceType,
): readonly WorkspaceImageFieldPair[] {
  const pairs: WorkspaceImageFieldPair[] = [];
  addImageFieldPair(pairs, record, sourceType, "source", "imageSourceType");
  addImageFieldPair(pairs, record, sourceType, "fillImageSource", "fillImageSourceType");
  addImageFieldPair(pairs, record, sourceType, "source", "sourceType");
  return pairs;
}

function addImageFieldPair(
  pairs: WorkspaceImageFieldPair[],
  record: Readonly<Record<string, unknown>>,
  sourceType: WorkspaceImageSourceType,
  sourceKey: string,
  typeKey: string,
): void {
  const source = record[sourceKey];
  if (record[typeKey] === sourceType && typeof source === "string" && source.length > 0) {
    pairs.push({ source, sourceKey, typeKey });
  }
}

function visitRecords(
  value: unknown,
  sourceType: WorkspaceImageSourceType,
  visit: (reference: WorkspaceImageReference) => void,
): void {
  if (Array.isArray(value)) {
    for (const item of value) visitRecords(item, sourceType, visit);
    return;
  }
  if (!isRecord(value)) return;

  for (const reference of imageFieldPairs(value, sourceType)) visit(reference);
  visitSerializedResources(value["resources"], sourceType, visit);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "resources") visitRecords(child, sourceType, visit);
  }
}

function visitSerializedResources(
  value: unknown,
  sourceType: WorkspaceImageSourceType,
  visit: (reference: WorkspaceImageReference) => void,
): void {
  if (!Array.isArray(value)) return;
  for (const resource of value) {
    visitRecords(resource, sourceType, visit);
    if (!isRecord(resource) || typeof resource["data"] !== "string") continue;
    const parsed = parseJson(resource["data"]);
    if (parsed !== undefined) visitRecords(parsed, sourceType, visit);
  }
}

function rewriteSerializedResources(
  value: unknown,
  sourceType: WorkspaceImageSourceType,
  replacementType: WorkspaceImageSourceType,
  replacementBySource: ReadonlyMap<string, string>,
): RewriteResult {
  if (!Array.isArray(value)) {
    return rewriteValue(value, sourceType, replacementType, replacementBySource);
  }
  let changed = false;
  const rewritten = value.map((resource) => {
    const resourceResult = rewriteValue(resource, sourceType, replacementType, replacementBySource);
    let next = resourceResult.value;
    let resourceChanged = resourceResult.changed;
    if (!isRecord(resource) || typeof resource["data"] !== "string") {
      changed ||= resourceChanged;
      return next;
    }
    const parsed = parseJson(resource["data"]);
    if (parsed === undefined) {
      changed ||= resourceChanged;
      return next;
    }
    const dataResult = rewriteValue(parsed, sourceType, replacementType, replacementBySource);
    if (dataResult.changed) {
      next = { ...(isRecord(next) ? next : resource), data: JSON.stringify(dataResult.value) };
      resourceChanged = true;
    }
    changed ||= resourceChanged;
    return next;
  });
  return changed ? { changed: true, value: rewritten } : { changed: false, value };
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
