import { lazy, Suspense } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { isMobileDevice } from "../../shared/platform";
import { Spinner } from "../../shared/ui";
import type { CollaborationEditorProps } from "./collaboration-editor";

const mobile = isMobileDevice();
const SheetEditor = mobile
  ? lazy(() => import("./units/sheet/sheet-editor.mobile"))
  : lazy(() => import("./units/sheet/sheet-editor"));
const DocEditor = mobile
  ? lazy(() => import("./units/doc/doc-editor.mobile"))
  : lazy(() => import("./units/doc/doc-editor"));
const SlideEditor = mobile
  ? lazy(() => import("./units/slide/slide-editor.mobile"))
  : lazy(() => import("./units/slide/slide-editor"));
const BoardEditor = mobile
  ? lazy(() => import("./units/board/board-editor.mobile"))
  : lazy(() => import("./units/board/board-editor"));
const BaseEditor = mobile
  ? lazy(() => import("./units/base/base-editor.mobile"))
  : lazy(() => import("./units/base/base-editor"));

type UnitType = components["schemas"]["UnitType"];

export function ResourceEditor(props: {
  readonly previewToken?: string;
  readonly unitId: string;
  readonly unitType: NonNullable<UnitType>;
  readonly user: CollaborationEditorProps["user"];
  readonly collaborationScope?: CollaborationEditorProps["collaborationScope"];
  readonly mappedUnitIds?: CollaborationEditorProps["mappedUnitIds"];
  readonly readOnly?: boolean;
  readonly onCollaboratorsChange?: CollaborationEditorProps["onCollaboratorsChange"];
}) {
  const editorProps = {
    unitId: props.unitId,
    ...(props.previewToken ? { previewToken: props.previewToken } : {}),
    user: props.user,
    ...(props.onCollaboratorsChange
      ? { onCollaboratorsChange: props.onCollaboratorsChange }
      : {}),
    ...(props.readOnly === undefined
      ? {}
      : { readOnly: props.readOnly }),
    ...(props.collaborationScope
      ? { collaborationScope: props.collaborationScope }
      : {}),
    ...(props.mappedUnitIds
      ? { mappedUnitIds: props.mappedUnitIds }
      : {}),
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
