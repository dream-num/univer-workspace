import { Separator as BaseSeparator } from "@base-ui/react/separator";
import type { ComponentProps } from "react";
import { cn } from "./cn.js";
import css from "./separator.module.scss";

export function Separator(props: ComponentProps<typeof BaseSeparator>) {
  return <BaseSeparator {...props} className={cn(css.separator, props.className)} />;
}
