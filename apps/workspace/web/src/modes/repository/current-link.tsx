import { createLink } from "@tanstack/react-router";
import type { ComponentProps } from "react";

// The frame owns selection, including tabs sharing a pathname or a parent route.
export function CurrentAnchor({ current, ...props }: ComponentProps<"a"> & { readonly current: boolean }) {
  return <a {...props} aria-current={current ? "page" : undefined} />;
}

export const CurrentLink = createLink(CurrentAnchor);
