export interface HtmlCellReference {
  readonly unitId: string;
  readonly sheetId: string;
  readonly row: number;
  readonly col: number;
}
export interface HtmlViewBinding {
  readonly id: string;
  readonly kind: "text" | "model";
  readonly reference: HtmlCellReference;
  readonly disabled: boolean;
}
export interface HtmlViewDocument {
  readonly html: string;
  readonly bindings: readonly HtmlViewBinding[];
}
