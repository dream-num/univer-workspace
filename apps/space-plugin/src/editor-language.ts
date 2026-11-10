import { LocaleType } from '@univerjs/core';

/** Read-only face of the caller's existing UI language source. No preference writes. */
export interface EditorLanguageSource {
  getSnapshot(): {
    active: string;
    locales?: readonly { id: string; fallback?: string }[];
  };
  subscribe(listener: () => void): () => void;
}

/** Only the shipped English/Simplified Chinese packs are available to Univer. */
export function editorLocale(snapshot: ReturnType<EditorLanguageSource['getSnapshot']>): LocaleType {
  let id: string | undefined = snapshot.active;
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    switch (id.toLowerCase()) {
      case 'zh': case 'zh-cn': case 'zh-hans': return LocaleType.ZH_CN;
      case 'en': case 'en-us': return LocaleType.EN_US;
    }
    id = snapshot.locales?.find(locale => locale.id === id)?.fallback;
  }
  return LocaleType.EN_US;
}

/** SDK 1.4 changes its LocaleService in place; never dispose/reload a Unit for language. */
export function bindEditorLanguage(
  target: { getCurrentLocale(): string; setLocale(locale: string): void },
  source: EditorLanguageSource,
): () => void {
  let disposed = false;
  const update = () => {
    if (disposed) return;
    const locale = editorLocale(source.getSnapshot());
    if (target.getCurrentLocale() !== locale) target.setLocale(locale);
  };
  const unsubscribe = source.subscribe(update);
  // Read again after subscription: a switch during SDK startup must not be lost.
  update();
  return () => { if (disposed) return; disposed = true; unsubscribe(); };
}
