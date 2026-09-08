import type { ReadOnlyLocaleCopy } from "./readonly.ts";

export const READ_ONLY_COPY: Record<"zh-CN" | "en-US", ReadOnlyLocaleCopy> = {
  "zh-CN": {
    title: "只读视图",
    message: "当前视图为只读；提交确认的修改请在对应 worktree 中进行。",
  },
  "en-US": {
    title: "Read-only view",
    message: "This view is read-only; confirmed edits live in their worktree.",
  },
};
