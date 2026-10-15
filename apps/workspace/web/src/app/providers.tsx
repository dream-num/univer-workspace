import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type PropsWithChildren } from "react";
import { LanguageProvider, useI18n } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { Toaster, TooltipProvider, toast } from "../shared/ui";
import { installChunkLoadRecovery } from "./chunk-load-recovery";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider timeout={350}>{children}</TooltipProvider>
          <Toaster />
          <ChunkLoadRecovery />
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

function ChunkLoadRecovery() {
  const { t } = useI18n();
  useEffect(
    () =>
      installChunkLoadRecovery(() => {
        toast.error(t("pageLoadFailed"), {
          id: "workspace-chunk-load-error",
          duration: Infinity,
          description: t("pageReloadWarning"),
          action: {
            label: t("reloadPage"),
            onClick: () => window.location.reload(),
          },
        });
      }),
    [t],
  );
  return null;
}
