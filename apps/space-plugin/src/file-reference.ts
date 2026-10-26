import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client';
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    'workspace-file': {
      label: string;
      nodeId: string;
      resourceId: string;
      unitId: string;
    };
  }
}
/** Original stable wire text is unchanged; recognition grants no read authority. */
export const workspaceReferenceRule: UserTextRule<'workspace-file'> = {
  id: 'workspace-file',
  order: 10,
  match(text, from) {
    const expression =
      /\[((?:\\.|[^\]\\\r\n])+)\]\((workspace-file:\/\/[^\s)]+)\)/g;
    expression.lastIndex = from;
    for (
      let match = expression.exec(text);
      match;
      match = expression.exec(text)
    ) {
      try {
        const url = new URL(match[2]);
        const resourceId = decodeURIComponent(url.hostname),
          nodeId = url.searchParams.get('nodeId'),
          unitId = url.searchParams.get('unitId');
        if (
          url.protocol !== 'workspace-file:' ||
          !resourceId ||
          !nodeId ||
          !unitId ||
          url.username ||
          url.password ||
          url.port ||
          url.pathname ||
          url.hash
        )
          continue;
        return {
          id: 'workspace-file',
          start: match.index,
          end: match.index + match[0].length,
          data: {
            label: match[1].replace(/\\([\\[\]])/g, '$1'),
            nodeId,
            resourceId,
            unitId,
          },
        };
      } catch {
        /* Malformed source remains ordinary visible text. */
      }
    }
    return undefined;
  },
};
