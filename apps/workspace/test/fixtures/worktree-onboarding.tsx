import { useState } from "react";
import { Toaster } from "sonner";
import { createRoot } from "react-dom/client";
import { LanguageProvider, useI18n } from "../../web/src/shared/i18n";
import { ThemeProvider } from "../../web/src/shared/theme";
import { WorktreeOnboarding } from "../../web/src/features/worktrees/worktree-onboarding";
import "../../web/src/app/styles/global.css";

function Fixture() {
  const { language, setLanguage } = useI18n();
  const [dark, setDark] = useState(false);
  const [compact, setCompact] = useState(false);
  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-background text-foreground">
        <div className="flex flex-wrap gap-5 border-b border-border p-4 text-sm">
          <label>
            <input
              type="checkbox"
              checked={dark}
              onChange={(event) => setDark(event.target.checked)}
            />{" "}
            Dark theme
          </label>
          <label>
            <input
              type="checkbox"
              checked={compact}
              onChange={(event) => setCompact(event.target.checked)}
            />{" "}
            Team hint
          </label>
          <label>
            Language{" "}
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as "zh-CN" | "en-US")}
            >
              <option value="en-US">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
        </div>
        <Toaster position="top-center" richColors />
        <WorktreeOnboarding origin="https://workspace.example.test" compact={compact} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <LanguageProvider>
      <Fixture />
    </LanguageProvider>
  </ThemeProvider>,
);
