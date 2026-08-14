import { useI18n } from "../../shared/i18n";
import { Badge } from "../../shared/ui";

type Role = "owner" | "admin" | "editor" | "viewer";

const roleVariants = {
  owner: "warning",
  admin: "violet",
  editor: "brand",
  viewer: "default",
} as const;

export function RoleBadge({ role }: { readonly role: Role }) {
  const { t } = useI18n();
  const label =
    role === "owner"
      ? t("accessOwner")
      : role === "admin"
        ? t("accessAdmin")
        : role === "editor"
          ? t("accessEditor")
          : t("accessViewer");
  return <Badge variant={roleVariants[role]}>{label}</Badge>;
}
