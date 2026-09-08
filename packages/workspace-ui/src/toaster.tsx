import { Toaster as SonnerToaster, toast } from "sonner";

export { toast };

export function WorkspaceToaster(props: { readonly theme?: "light" | "dark" | "system" }) {
  return (
    <SonnerToaster
      theme={props.theme ?? "system"}
      position="top-center"
      offset={20}
      gap={8}
      richColors
      closeButton
      toastOptions={{ classNames: { toast: "workspace-sonner-toast" } }}
    />
  );
}
