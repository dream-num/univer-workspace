import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "../theme";

export { toast } from "sonner";

export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme}
      position="top-center"
      offset={20}
      gap={8}
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "sonner-toast-custom",
        },
      }}
    />
  );
}
