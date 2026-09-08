import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { cn } from "./cn.js";
import css from "./avatar.module.scss";

export function Avatar(props: {
  readonly src?: string | null | undefined;
  readonly name: string;
  readonly size?: "xs" | "sm" | "md" | "lg";
  readonly className?: string | undefined;
}) {
  const size = props.size ?? "md";
  return (
    <BaseAvatar.Root className={cn(css.avatar, css[size], props.className)}>
      {props.src ? <BaseAvatar.Image src={props.src} alt="" className={css.image} /> : null}
      <BaseAvatar.Fallback>
        {props.name.trim().slice(0, 1).toUpperCase() || "?"}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}
