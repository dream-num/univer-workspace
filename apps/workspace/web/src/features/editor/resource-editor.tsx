import { lazy, Suspense } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { Spinner } from "../../shared/ui";
import type { CollaborationEditorProps } from "./collaboration-editor";

const SheetEditor = lazy(() => import("./sheet-editor"));
const DocEditor = lazy(() => import("./doc-editor"));
const SlideEditor = lazy(() => import("./slide-editor"));
const BoardEditor = lazy(() => import("./board-editor"));
const BaseEditor = lazy(() => import("./base-editor"));

type UnitType = components["schemas"]["UnitType"];

export function ResourceEditor(props: {
  readonly unitId: string;
  readonly unitType: NonNullable<UnitType>;
  readonly user: CollaborationEditorProps["user"];
  readonly collaborationScope?: CollaborationEditorProps["collaborationScope"];
  readonly mappedUnitIds?: CollaborationEditorProps["mappedUnitIds"];
  readonly readOnly?: boolean;
  readonly materializedData?: Readonly<Record<string, unknown>>;
  readonly instanceKey?: string;
}) {
  const editorProps = {
    unitId: props.unitId,
    user: props.user,
    ...(props.readOnly === undefined
      ? {}
      : { readOnly: props.readOnly }),
    ...(props.collaborationScope
      ? { collaborationScope: props.collaborationScope }
      : {}),
    ...(props.mappedUnitIds
      ? { mappedUnitIds: props.mappedUnitIds }
      : {}),
    ...(props.materializedData === undefined
      ? {}
      : { materializedData: props.materializedData }),
    ...(props.instanceKey === undefined
      ? {}
      : { instanceKey: props.instanceKey }),
  };
  return (
    <Suspense
      fallback={
        <div className="grid h-full place-items-center">
          <Spinner className="size-6 text-brand-600" />
        </div>
      }
    >
      {props.unitType === "sheet" ? (
        <SheetEditor {...editorProps} />
      ) : props.unitType === "doc" ? (
        <DocEditor {...editorProps} />
      ) : props.unitType === "slide" ? (
        <SlideEditor {...editorProps} />
      ) : props.unitType === "board" ? (
        <BoardEditor {...editorProps} />
      ) : <BaseEditor {...editorProps} />}
    </Suspense>
  );
}
