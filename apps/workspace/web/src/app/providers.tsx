import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { LanguageProvider } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { UiModeProvider } from "../shared/ui-mode";
import { Toaster, TooltipProvider } from "../shared/ui";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const UI_MODES = ["wiki", "repository"] as const;

export function Providers({ children }: PropsWithChildren) {
  return (
    <UiModeProvider modes={UI_MODES} fallback="wiki">
    <ThemeProvider>
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider timeout={350}>{children}</TooltipProvider>
          <Toaster />
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
    </UiModeProvider>
  );
}
