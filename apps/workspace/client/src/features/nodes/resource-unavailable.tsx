import { Link } from "@tanstack/react-router";
import { FileQuestion, Home } from "lucide-react";
import { ApiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { buttonVariants } from "../../shared/ui";

export function isResourceUnavailableError(error: unknown) {
  return error instanceof ApiError && error.code === "NOT_FOUND";
}

export function ResourceUnavailablePage() {
  const { t } = useI18n();

  return (
    <main className="auth-backdrop grid min-h-dvh place-items-center px-5 py-8">
      <section className="flex w-[min(480px,100%)] flex-col items-center rounded-2xl border border-border bg-background p-8 text-center shadow-lg max-[480px]:border-0 max-[480px]:bg-transparent max-[480px]:p-4 max-[480px]:shadow-none">
        <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground [&_svg]:size-7">
          <FileQuestion aria-hidden="true" />
        </span>
        <h1 className="m-0 text-xl font-bold tracking-tight text-foreground">
          {t("resourceUnavailableTitle")}
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          {t("resourceUnavailableDescription")}
        </p>
        <Link
          to="/home"
          className={`${buttonVariants({ size: "lg" })} mt-7 no-underline`}
        >
          <Home />
          {t("backToHome")}
        </Link>
      </section>
    </main>
  );
}
