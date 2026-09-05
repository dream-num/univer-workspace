import { useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { Table2, Trash2, CheckCircle2, Send } from "lucide-react";
import { LanguageProvider, useI18n, type AppLanguage } from "../src/shared/i18n";
import { Alert, Badge, Button, Segmented } from "../src/shared/ui";
import { WorktreeReviewHeader } from "../src/features/worktrees/worktree-review-header";
import type { WorktreeReviewMode } from "../src/features/worktrees/worktree-review-presentation";
import "../src/app/styles/global.css";

/** Real application Header with inert actions; does not access Workspace data. */
function Fixture(): ReactElement {
  const { t, language, setLanguage } = useI18n();
  const [width, setWidth] = useState(1130);
  const [name, setName] = useState("all-unit-comparison-changes");
  const [state, setState] = useState("ready");
  const [mode, setMode] = useState<WorktreeReviewMode>("view");
  const [preview, setPreview] = useState<"preview" | "agent">("preview");
  const [action, setAction] = useState("");
  const [dark, setDark] = useState(false);
  return (
    <div
      className={dark ? "dark" : ""}
      style={{ padding: 16, overflow: "auto", minHeight: "100vh" }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <label>
          Frame width{" "}
          <input
            aria-label="Frame width"
            type="number"
            value={width}
            onChange={(event) => setWidth(Number(event.target.value))}
          />
        </label>
        <label>
          Document name{" "}
          <input
            aria-label="Document name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          State{" "}
          <select
            aria-label="State"
            value={state}
            onChange={(event) => setState(event.target.value)}
          >
            {["ready", "preview", "draft", "conflict", "merged", "no-view"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Language{" "}
          <select
            aria-label="Language"
            value={language}
            onChange={(event) => setLanguage(event.target.value as AppLanguage)}
          >
            <option>zh-CN</option>
            <option>en-US</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => setDark(event.target.checked)}
          />
          Dark
        </label>
        <output aria-label="Last action">{action}</output>
      </div>
      <div
        data-frame
        style={{ display: "flex", width, minHeight: 400 }}
        className="border border-border bg-background text-foreground"
      >
        <aside style={{ width: 256, flexShrink: 0 }} className="border-r border-border">
          Fixture worktree (not the document title)
        </aside>
        <main className="min-w-0 flex-1">
          <WorktreeReviewHeader
            documentName={name}
            icon={<Table2 size={20} />}
            badge={
              <Badge
                className="min-w-0 shrink whitespace-normal [overflow-wrap:anywhere]"
                variant="success"
              >
                {t("documentAdded")}
              </Badge>
            }
            resultBadge={
              state === "merged" && (
                <Badge variant="success">
                  {t("mergeResultLabel", { value: t("merged") })}
                </Badge>
              )
            }
            view={
              state === "no-view"
                ? undefined
                : {
                    value: mode,
                    onChange: (value) => {
                      setMode(value);
                      setAction(value);
                    },
                  }
            }
            actions={
              state === "merged" ? null : (
                <>
                  <Button
                    size="sm"
                    disabled={state === "conflict"}
                    onClick={() => setAction(state === "draft" ? "submit" : "merge")}
                  >
                    {state === "draft" ? <Send /> : <CheckCircle2 />}
                    {t(state === "draft" ? "submitForReview" : "confirmMerge")}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive-ghost"
                    onClick={() => setAction("discard")}
                  >
                    <Trash2 />
                    {t("discardChanges")}
                  </Button>
                </>
              )
            }
          />
          {state === "preview" && (
            <Alert className="mx-4.5 mt-3" variant="info">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1">{t("trunkAdvancedPreviewReady")}</span>
                {mode !== "compare" && (
                  <Segmented<"preview" | "agent">
                    size="sm"
                    aria-label={t("mergePreview")}
                    className="grid max-w-full grid-cols-2"
                    itemClassName="h-auto min-h-7 min-w-0 whitespace-normal [overflow-wrap:anywhere] py-1"
                    value={preview}
                    onValueChange={setPreview}
                    options={[
                      { value: "preview", label: t("mergePreview") },
                      { value: "agent", label: t("agentVersion") },
                    ]}
                  />
                )}
              </div>
            </Alert>
          )}
        </main>
      </div>
    </div>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(
  <LanguageProvider>
    <Fixture />
  </LanguageProvider>,
);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
