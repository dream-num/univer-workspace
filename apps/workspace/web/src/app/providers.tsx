import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type PropsWithChildren } from "react";
import { MODE_IDS, useModeDefinition } from "../modes/registry";
import { LanguageProvider } from "../shared/i18n";
import { ThemeProvider } from "../shared/theme";
import { UiModeProvider, useUiMode } from "../shared/ui-mode";
import { Toaster, TooltipProvider } from "../shared/ui";

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
    <UiModeProvider modes={MODE_IDS} fallback="wiki">
      <ModeProviders>{children}</ModeProviders>
    </UiModeProvider>
  );
}

function ModeProviders({ children }: PropsWithChildren) {
  const { mode } = useUiMode();
  const { messages } = useModeDefinition();
  useEffect(() => {
    document.documentElement.dataset.uiMode = mode;
  }, [mode]);

  return (
    <ThemeProvider>
      <LanguageProvider overrides={messages}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider timeout={350}>{children}</TooltipProvider>
          <Toaster />
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
