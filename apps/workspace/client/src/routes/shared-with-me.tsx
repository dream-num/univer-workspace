import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/shared-with-me")({
  beforeLoad: () => {
    throw redirect({
      to: "/home",
      search: { view: "shared" },
      replace: true,
    });
  },
});
