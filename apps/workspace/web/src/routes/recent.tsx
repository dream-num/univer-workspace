import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/recent")({
  beforeLoad: () => {
    throw redirect({ to: "/home", replace: true });
  },
});
