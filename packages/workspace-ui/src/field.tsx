import type { ReactNode } from "react";
import { cn } from "./cn.js";
import css from "./field.module.scss";

export function Field(props: {
  readonly label?: ReactNode;
  readonly htmlFor?: string | undefined;
  readonly error?: string | undefined;
  readonly hint?: ReactNode;
  readonly required?: boolean | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className={cn(css.field, props.className)}>
      {props.label ? (
        <label htmlFor={props.htmlFor} className={css.label}>
          {props.label}
          {props.required ? <span className={css.required}>*</span> : null}
        </label>
      ) : null}
      {props.children}
      {props.error ? (
        <p role="alert" className={css.error}>
          {props.error}
        </p>
      ) : props.hint ? (
        <p className={css.hint}>{props.hint}</p>
      ) : null}
    </div>
  );
}
