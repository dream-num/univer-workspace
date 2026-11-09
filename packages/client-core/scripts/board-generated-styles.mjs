/**
 * Create a compact native hierarchy from newly generated plain text.
 * Existing maps and authored rich-text blueprints are never normalized by this helper.
 *
 * @param {import("@univerjs-pro/boards/facade").FBoard} board
 * @param {import("@univerjs-pro/boards-mind/facade").IBoardMindMapFacadeInsertOptions} options
 * @returns {import("@univerjs-pro/boards-mind/facade").FBoardMindMap | null}
 */
export function insertCompactGeneratedMindMap(board, options) {
  const checkPlain = (input) => {
    if (typeof input.text !== "string")
      throw new TypeError("Compact generation requires plain text; preserve authored rich text");
    for (const child of input.children ?? []) checkPlain(child);
  };
  checkPlain(options.root);
  const map = board.insertMindMap(options);
  if (!map) return null;
  const rootId = map.getRootNode()?.getId();
  if (!rootId) throw new Error("Generated native hierarchy has no root");
  const theme = board.getThemeData();
  const colors = theme.colorScheme ?? {};
  for (const node of map.getNodes()) {
    const root = node.getId() === rootId;
    const text = node.getText();
    const fontFamily = root ? theme.fontScheme?.heading : theme.fontScheme?.body;
    if (
      !node.setStyle({
        ...(colors.acc1 ? { strokeColor: colors.acc1 } : {}),
        ...(root && colors.acc1 ? { fillColor: colors.acc1 } : {}),
        ...(!root && colors.lt1 ? { fillColor: colors.lt1 } : {}),
        stroke: { width: 1.25 },
        textStyle: {
          fontSize: root ? 12 : 10.5,
          ...(fontFamily ? { fontFamily } : {}),
          ...(root && colors.lt1 ? { color: colors.lt1 } : {}),
          ...(!root && colors.dk1 ? { color: colors.dk1 } : {}),
        },
      })
    )
      throw new Error("Cannot style generated native node");
    if (
      !root &&
      !node.setIncomingConnectorStyle({
        strokeWidth: 1.25,
        ...(colors.acc1 ? { stroke: colors.acc1 } : {}),
      })
    )
      throw new Error("Cannot style generated native branch");
    if (node.getText() !== text) throw new Error("Generated native text changed during styling");
  }
  return map;
}
