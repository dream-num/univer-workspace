import type { BindingEngine, CellReference, CellState, CellValue } from "@univerjs/binding-engine";

export type CellBindingEngine = Pick<
  BindingEngine,
  "getCellState" | "subscribeCell" | "setCellValue"
>;
export interface CellBindingTarget {
  readonly element: HTMLElement;
  readonly kind: "text" | "model";
  readonly engine: CellBindingEngine;
  readonly reference: CellReference;
}
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
interface Edit {
  input: Control;
  disabled: boolean;
  dirty: boolean;
  error?: HTMLElement;
  message?: string;
}
interface Group {
  engine: CellBindingEngine;
  reference: CellReference;
  key: string;
  texts: HTMLElement[];
  edits: Edit[];
  lastWrite: number;
  pending?: Edit;
  timer?: ReturnType<typeof setTimeout>;
}

// 只消费已加载 Engine；所有异步加载、保存确认和 Unit 释放由宿主管理。
export function mountCellBindings(
  targets: readonly CellBindingTarget[],
  onError: (message: string) => void = () => {},
) {
  const groups: Group[] = [];
  const cleanup: (() => void)[] = [];
  let disposed = false;
  let reported = "";
  const report = () => {
    const message =
      groups.flatMap((group) => group.edits).find((edit) => edit.message)?.message ?? "";
    if (disposed || message === reported) return;
    reported = message;
    onError(message);
  };
  const clearError = (edit: Edit) => {
    edit.error?.remove();
    delete edit.error;
    delete edit.message;
    edit.input.removeAttribute("aria-invalid");
  };
  const showError = (edit: Edit, message: string) => {
    clearError(edit);
    edit.message = message;
    edit.input.setAttribute("aria-invalid", "true");
    edit.error = edit.input.ownerDocument.createElement("span");
    edit.error.setAttribute("role", "alert");
    edit.error.textContent = message;
    edit.input.insertAdjacentElement("afterend", edit.error);
  };
  const numeric = (input: Control) =>
    input.tagName === "INPUT" && ["number", "range"].includes(input.type);
  const checkbox = (input: Control): input is HTMLInputElement =>
    input.tagName === "INPUT" && input.type === "checkbox";
  const compatible = (input: Control, value: CellValue | null) =>
    value === null ||
    (checkbox(input)
      ? typeof value === "boolean"
      : numeric(input)
        ? typeof value === "number"
        : typeof value === "string");
  const render = (group: Group, state: CellState) => {
    if (disposed) return;
    for (const text of group.texts)
      text.textContent = state.available ? String(state.value ?? "") : "数据不可用";
    for (const edit of group.edits) {
      edit.input.disabled =
        edit.disabled ||
        !state.available ||
        !state.writable ||
        !compatible(edit.input, state.value);
      if (!state.available) {
        showError(edit, "单元格不可用。");
        continue;
      }
      if (edit.dirty) continue;
      if (!compatible(edit.input, state.value)) {
        showError(edit, "单元格类型与控件不兼容。");
        continue;
      }
      clearError(edit);
      if (checkbox(edit.input)) edit.input.checked = state.value === true;
      else edit.input.value = String(state.value ?? "");
    }
    report();
  };
  const cancelPending = (group: Group) => {
    if (group.timer) clearTimeout(group.timer);
    delete group.timer;
    delete group.pending;
  };
  const write = (group: Group, edit: Edit) => {
    if (disposed) return;
    cancelPending(group);
    edit.dirty = true;
    try {
      const state = group.engine.getCellState(group.reference);
      if (
        edit.disabled ||
        ("readOnly" in edit.input && edit.input.readOnly) ||
        !state.available ||
        !state.writable
      )
        throw new Error("单元格不可写。");
      if (!compatible(edit.input, state.value)) throw new Error("单元格类型与控件不兼容。");
      if (!edit.input.validity.valid) throw new Error("输入不符合控件约束。");
      let value: CellValue;
      if (checkbox(edit.input)) value = edit.input.checked;
      else if (numeric(edit.input)) {
        if (!edit.input.value.trim()) throw new Error("请输入有效数字。");
        value = Number(edit.input.value);
        if (!Number.isFinite(value)) throw new Error("请输入有效数字。");
      } else value = edit.input.value;
      group.engine.setCellValue(group.reference, value);
      group.lastWrite = Date.now();
      edit.dirty = false;
      clearError(edit);
      render(group, group.engine.getCellState(group.reference));
      return true;
    } catch (error) {
      showError(edit, error instanceof Error ? error.message : String(error));
      report();
      return false;
    }
  };
  const submit = (group: Group, edit: Edit, immediate: boolean) => {
    if (disposed) return;
    if (group.pending && group.pending !== edit) {
      group.pending.dirty = false;
      clearError(group.pending);
    }
    cancelPending(group);
    const wait = immediate ? 0 : Math.max(0, 100 - (Date.now() - group.lastWrite));
    if (!wait) {
      write(group, edit);
      return;
    }
    group.pending = edit;
    group.timer = setTimeout(() => write(group, edit), wait);
    render(group, group.engine.getCellState(group.reference));
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const group of groups) {
      cancelPending(group);
      for (const edit of group.edits) {
        clearError(edit);
        edit.input.disabled = true;
      }
    }
    for (const fn of cleanup) fn();
  };
  try {
    for (const target of targets) {
      const key = JSON.stringify([
        target.reference.sheetId,
        target.reference.row,
        target.reference.col,
      ]);
      let group = groups.find((group) => group.engine === target.engine && group.key === key);
      if (!group) {
        group = {
          engine: target.engine,
          reference: target.reference,
          key,
          texts: [],
          edits: [],
          lastWrite: -Infinity,
        };
        groups.push(group);
      }
      if (target.kind === "text") {
        group.texts.push(target.element);
        continue;
      }
      const input = target.element as Control;
      if (
        !["INPUT", "SELECT", "TEXTAREA"].includes(input.tagName) ||
        (input.tagName === "INPUT" &&
          !["text", "number", "range", "checkbox"].includes(input.type)) ||
        (input.tagName === "SELECT" && (input as HTMLSelectElement).multiple)
      )
        throw new Error("Unsupported model binding control.");
      const edit: Edit = { input, disabled: input.disabled, dirty: false };
      group.edits.push(edit);
      const current = group;
      const onInput = () => {
        edit.dirty = true;
        if (input.type === "range") submit(current, edit, false);
      };
      const onChange = () => submit(current, edit, true);
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (current.pending === edit) cancelPending(current);
        edit.dirty = false;
        clearError(edit);
        render(current, current.engine.getCellState(current.reference));
      };
      input.addEventListener("input", onInput);
      input.addEventListener("change", onChange);
      input.addEventListener("keydown", onKey as EventListener);
      cleanup.push(() => {
        input.removeEventListener("input", onInput);
        input.removeEventListener("change", onChange);
        input.removeEventListener("keydown", onKey as EventListener);
      });
    }
    for (const group of groups) {
      const subscription = group.engine.subscribeCell(group.reference, (state) =>
        render(group, state),
      );
      cleanup.push(() => subscription.dispose());
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    dispose,
    hasPendingChanges: () =>
      !disposed && groups.some((group) => group.edits.some((edit) => edit.dirty)),
    // 先把 DOM 草稿同步写入 Engine，宿主随后等待 SDK 协同确认。
    flush() {
      if (disposed) throw new Error("HTML bindings are disposed.");
      for (const group of groups) {
        for (const edit of group.edits) {
          if (edit.dirty && !write(group, edit)) throw new Error(edit.message);
        }
      }
    },
  };
}
