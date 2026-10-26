import { DocumentFlavor } from '@univerjs/core';
import type { Content } from './model.js';
/** Detached view projection only. The Server snapshot and rich body stay intact. */
export function viewerData(file: Content) {
  const data = structuredClone(file.data);
  if (file.type === 'doc') {
    data.title = file.name;
    data.documentStyle = {
      ...data.documentStyle,
      documentFlavor: DocumentFlavor.MODERN,
      pageSize: { ...data.documentStyle?.pageSize, width: 868 },
      marginTop: 0,
      marginBottom: 24,
      marginLeft: 50,
      marginRight: 50,
    };
  } else data.name = file.name;
  return data;
}
