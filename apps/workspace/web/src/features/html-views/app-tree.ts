const HTML_VIEW_SUFFIX = /\.univer\.html$/i;

export interface AppTreeItem {
  readonly resource: { readonly id: string };
  readonly node: { readonly id: string; readonly name: string };
  readonly location: {
    readonly space: {
      readonly id: string;
      readonly name: string;
      readonly type: "personal" | "team";
    };
    readonly breadcrumbs: readonly { readonly id: string; readonly name: string }[];
  };
}

export interface AppTreeFolder {
  readonly id: string;
  readonly name: string;
  readonly folders: AppTreeFolder[];
  readonly files: AppTreeItem[];
}

export interface AppTreeSpace extends AppTreeFolder {
  readonly type: "personal" | "team";
}

export function appTitle(name: string) {
  const stripped = name.replace(HTML_VIEW_SUFFIX, "");
  return stripped || name;
}

export function spaceLabel(
  space: { readonly type: "personal" | "team"; readonly name: string },
  t: (key: "personalSpace") => string,
) {
  return space.type === "personal" ? t("personalSpace") : space.name;
}

export function selectedHtmlView(items: readonly AppTreeItem[], nodeId: string | undefined) {
  return items.find((item) => item.node.id === nodeId) ?? items[0];
}

export function buildAppTree(items: readonly AppTreeItem[]): AppTreeSpace[] {
  const spaces: AppTreeSpace[] = [];
  const bySpace = new Map<string, AppTreeSpace>();
  for (const item of items) {
    const source = item.location.space;
    let space = bySpace.get(source.id);
    if (!space) {
      space = { id: source.id, name: source.name, type: source.type, folders: [], files: [] };
      bySpace.set(source.id, space);
      spaces.push(space);
    }
    let folders = space.folders;
    let parent: AppTreeFolder = space;
    for (const breadcrumb of item.location.breadcrumbs) {
      let folder = folders.find((entry) => entry.id === breadcrumb.id);
      if (!folder) {
        folder = { id: breadcrumb.id, name: breadcrumb.name, folders: [], files: [] };
        folders.push(folder);
      }
      parent = folder;
      folders = folder.folders;
    }
    parent.files.push(item);
  }
  return spaces;
}
