/** unit 会话注册表:按 unitKey 缓存已加载 unit(LRU 上限,超限逐出最久未用)。 */
import { IUniverInstanceService, UniverInstanceType, type Univer } from "@univerjs/core";
import { codedError, settle, waitCanvasAtLeast, waitForRender } from "./support.js";

export type RenderUnitTypeWire = "sheet" | "doc" | "slide" | "board" | "base";
export type RenderFormulaReferenceUnitTypeWire = "sheet" | "base";

export interface RenderFormulaReferenceUnitSourceWire {
  readonly unitId: string;
  readonly unitType: RenderFormulaReferenceUnitTypeWire;
  readonly unitData: Record<string, unknown>;
}

export interface RenderEmbeddedUnitSourceWire {
  readonly unitId: string;
  readonly unitType: RenderUnitTypeWire;
  readonly unitData: Record<string, unknown>;
}

export interface LoadedUnit {
  readonly unitKey: string;
  readonly unitType: RenderUnitTypeWire;
  readonly unitId: string;
  readonly referenceUnitIds: readonly string[];
  readonly embeddedUnitIds: readonly string[];
  /** head 态引擎数据,布局捕获要用声明几何。 */
  readonly unitData: Record<string, unknown>;
  lastUsedAt: number;
}

/**
 * 同时仅保留 1 个 Host 会话；会话内 Formula Source / Embed child Units 与 Host
 * 共存。多个 Host 竞争 workbench 时画布挂载不可靠，v1 以重载换稳定。
 */
const MAX_LOADED_UNITS = 1;

const INSTANCE_TYPE: Record<RenderUnitTypeWire, UniverInstanceType> = {
  sheet: UniverInstanceType.UNIVER_SHEET,
  doc: UniverInstanceType.UNIVER_DOC,
  slide: UniverInstanceType.UNIVER_SLIDE,
  board: UniverInstanceType.UNIVER_BOARD,
  base: UniverInstanceType.UNIVER_BASE,
};

const REFERENCE_INSTANCE_TYPE: Record<RenderFormulaReferenceUnitTypeWire, UniverInstanceType> = {
  sheet: UniverInstanceType.UNIVER_SHEET,
  base: UniverInstanceType.UNIVER_BASE,
};

export class UnitRegistry {
  readonly #univer: Univer;
  readonly #units = new Map<string, LoadedUnit>();

  constructor(univer: Univer) {
    this.#univer = univer;
  }

  async load(input: {
    unitKey: string;
    unitType: RenderUnitTypeWire;
    unitData: Record<string, unknown>;
    formulaReferenceUnits?: readonly RenderFormulaReferenceUnitSourceWire[];
    embeddedUnits?: readonly RenderEmbeddedUnitSourceWire[];
  }): Promise<{ unitKey: string; loaded: true }> {
    const existing = this.#units.get(input.unitKey);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return { unitKey: input.unitKey, loaded: true };
    }
    const unitData = input.unitData;
    const unitId = typeof unitData.id === "string" ? unitData.id : "";
    if (unitId === "") {
      throw codedError("RENDER_INTERNAL", "unitData.id is required");
    }
    const references = validateFormulaReferenceUnits(unitId, input.formulaReferenceUnits ?? []);
    const referenceUnitIds = new Set(references.map((reference) => reference.unitId));
    const embeddedUnits = validateEmbeddedUnits(unitId, input.embeddedUnits ?? []).filter(
      (embedded) => !referenceUnitIds.has(embedded.unitId),
    );
    const incomingUnitIds = new Set([
      unitId,
      ...references.map((reference) => reference.unitId),
      ...embeddedUnits.map((embedded) => embedded.unitId),
    ]);
    // Host 或任一 Source id 与旧会话重叠时先逐出,避免引擎内撞 id。
    for (const [key, unit] of this.#units) {
      if (
        incomingUnitIds.has(unit.unitId) ||
        unit.referenceUnitIds.some((referenceUnitId) => incomingUnitIds.has(referenceUnitId)) ||
        unit.embeddedUnitIds.some((embeddedUnitId) => incomingUnitIds.has(embeddedUnitId))
      ) {
        this.#dispose(key);
      }
    }
    while (this.#units.size >= MAX_LOADED_UNITS) {
      const oldest = [...this.#units.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (!oldest) {
        break;
      }
      this.#dispose(oldest.unitKey);
    }
    const createdUnitIds: string[] = [];
    try {
      // Source 必须先于 Host 物化,否则 Host Formula Shape 首轮计算会把引用留在 pending。
      for (const reference of references) {
        this.#univer.createUnit(
          REFERENCE_INSTANCE_TYPE[reference.unitType],
          reference.unitData as object,
        );
        createdUnitIds.push(reference.unitId);
      }
      for (const embedded of embeddedUnits) {
        if (createdUnitIds.includes(embedded.unitId)) continue;
        this.#univer.createUnit(INSTANCE_TYPE[embedded.unitType], embedded.unitData as object);
        createdUnitIds.push(embedded.unitId);
      }
      this.#univer.createUnit(INSTANCE_TYPE[input.unitType], unitData as object);
      createdUnitIds.push(unitId);
      // 首个 unit 自动成为焦点,但逐出旧 unit 后新建的不会:显式聚焦,
      // 否则 slide/doc 的 workbench 画布不挂载(canvas 等待超时)。
      const instanceService = this.#univer.__getInjector().get(IUniverInstanceService);
      instanceService.focusUnit(unitId);
      instanceService.setCurrentUnitForType(unitId);
      await settle(120);
      // Sheet/Doc/Slide/Board 共用 workbench 主画布门。Base 的 canvas 由
      // BaseWorkbenchRenderService 在专属 canvas root 出现后异步挂载，后续
      // prepareBaseView 会按 active table/view + 精确 root/canvas 做完整 readiness。
      if (input.unitType !== "base") {
        await waitForRender(this.#univer, unitId);
        await waitCanvasAtLeast(300, 200);
      }
    } catch (error) {
      // 失败回滚:引擎 units 已建但未入注册表,不回收则同 id 重载永远撞车。
      const instanceService = this.#univer.__getInjector().get(IUniverInstanceService);
      for (const createdUnitId of createdUnitIds.reverse()) {
        try {
          instanceService.disposeUnit(createdUnitId);
        } catch {
          // 引擎侧已不存在时静默。
        }
      }
      throw error;
    }
    this.#units.set(input.unitKey, {
      unitKey: input.unitKey,
      unitType: input.unitType,
      unitId,
      referenceUnitIds: references.map((reference) => reference.unitId),
      embeddedUnitIds: embeddedUnits.map((embedded) => embedded.unitId),
      unitData,
      lastUsedAt: Date.now(),
    });
    return { unitKey: input.unitKey, loaded: true };
  }

  getSession(unitKey: string): { unitKey: string; loaded: boolean } | null {
    const unit = this.#units.get(unitKey);
    return unit ? { unitKey, loaded: true } : null;
  }

  /** 取已加载 unit;未加载抛 RENDER_UNIT_UNKNOWN(daemon 网关会透明重载重试)。 */
  require(unitKey: string): LoadedUnit {
    const unit = this.#units.get(unitKey);
    if (!unit) {
      throw codedError("RENDER_UNIT_UNKNOWN", `unit ${unitKey} is not loaded`);
    }
    unit.lastUsedAt = Date.now();
    return unit;
  }

  disposeUnit(unitKey: string): void {
    this.#dispose(unitKey);
  }

  #dispose(unitKey: string): void {
    const unit = this.#units.get(unitKey);
    if (!unit) {
      return;
    }
    this.#units.delete(unitKey);
    const instanceService = this.#univer.__getInjector().get(IUniverInstanceService);
    // 先释放 Host,再释放只为本会话物化的 Source Units。
    for (const unitId of [unit.unitId, ...unit.referenceUnitIds, ...unit.embeddedUnitIds]) {
      try {
        // Univer 门面类没有 disposeUnit,须经注入器拿实例服务;否则逐出是无声空转,
        // 旧引擎 unit 滞留导致同 id 重载撞 "cannot create a unit with the same unit id"。
        instanceService.disposeUnit(unitId);
      } catch {
        // 引擎侧已不存在时静默;注册表状态已清。
      }
    }
  }
}

function validateEmbeddedUnits(
  hostUnitId: string,
  embeddedUnits: readonly RenderEmbeddedUnitSourceWire[],
): readonly RenderEmbeddedUnitSourceWire[] {
  const unitIds = new Set([hostUnitId]);
  for (const embedded of embeddedUnits) {
    if (embedded.unitId === "" || unitIds.has(embedded.unitId)) {
      throw codedError(
        "RENDER_INTERNAL",
        `Embedded Unit id is empty or duplicated: ${embedded.unitId || "<empty>"}`,
      );
    }
    const snapshotUnitId =
      typeof embedded.unitData.id === "string" ? embedded.unitData.id : undefined;
    if (snapshotUnitId !== embedded.unitId) {
      throw codedError(
        "RENDER_INTERNAL",
        `Embedded Unit snapshot id mismatch: expected ${embedded.unitId}, got ${snapshotUnitId ?? "<missing>"}`,
      );
    }
    unitIds.add(embedded.unitId);
  }
  return embeddedUnits;
}

function validateFormulaReferenceUnits(
  hostUnitId: string,
  references: readonly RenderFormulaReferenceUnitSourceWire[],
): readonly RenderFormulaReferenceUnitSourceWire[] {
  const unitIds = new Set([hostUnitId]);
  for (const reference of references) {
    if (reference.unitId === "" || unitIds.has(reference.unitId)) {
      throw codedError(
        "RENDER_INTERNAL",
        `Formula reference Unit id is empty or duplicated: ${reference.unitId || "<empty>"}`,
      );
    }
    const snapshotUnitId =
      typeof reference.unitData.id === "string" ? reference.unitData.id : undefined;
    if (snapshotUnitId !== reference.unitId) {
      throw codedError(
        "RENDER_INTERNAL",
        `Formula reference Unit snapshot id mismatch: expected ${reference.unitId}, got ${snapshotUnitId ?? "<missing>"}`,
      );
    }
    unitIds.add(reference.unitId);
  }
  return references;
}
