import type { IMember } from "@univerjs/protocol";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CollaboratorAvatars } from "../../web/src/features/editor/collaborator-avatars";
import { LanguageProvider, useI18n } from "../../web/src/shared/i18n";
import { Button, TooltipProvider } from "../../web/src/shared/ui";
import "../../web/src/app/styles/global.css";

const avatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#93c5fd"/><circle cx="32" cy="24" r="12" fill="#1e40af"/><ellipse cx="32" cy="62" rx="25" ry="22" fill="#1e40af"/></svg>')}`;
const members: IMember[] = [
  { userID: "alice", memberID: "alice-1", name: "Alice", avatar },
  { userID: "alice", memberID: "alice-2", name: "Alice", avatar },
  { userID: "bob", memberID: "bob-1", name: "张小明" },
  { userID: "carol", memberID: "carol-1", name: "Carol", avatar: "data:image/png;base64,broken" },
  ...["David", "Emma", "Felix"].map((name) => ({ userID: name.toLowerCase(), memberID: name, name })),
];

function Fixture() {
  const { language, setLanguage, t } = useI18n();
  const [online, setOnline] = useState(true);
  const [dark, setDark] = useState(false);
  const [many, setMany] = useState(true);
  return (
    <div className={dark ? "dark" : ""}>
      <main className="min-h-dvh space-y-8 bg-background p-4 text-foreground">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setLanguage(language === "zh-CN" ? "en-US" : "zh-CN")}>Language</Button>
          <Button onClick={() => setOnline(!online)}>Toggle connection</Button>
          <Button onClick={() => setDark(!dark)}>Theme</Button>
          <Button onClick={() => setMany(!many)}>Toggle overflow</Button>
        </div>
        <header className="flex min-w-0 items-center gap-3 border-b border-border pb-3">
          <span className="min-w-0 flex-1 truncate font-semibold">Workspace collaboration example</span>
          <CollaboratorAvatars members={online ? (many ? members : members.slice(0, 5)) : []} currentUserId="alice" />
          <Button size="sm">{t("shareAction")}</Button>
        </header>
        <p>{many ? "7 connections / 6 users" : "5 connections / 4 users"}. Includes a profile image and missing/broken avatars.</p>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <LanguageProvider><TooltipProvider><Fixture /></TooltipProvider></LanguageProvider>
);
