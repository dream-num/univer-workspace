import { LocaleType, type ILanguagePack } from '@univerjs/core';
import { mergeLocales } from '@univerjs/presets';
import { sheetEditorLocales } from '@univerjs/univer-workspace-editor-presets/sheets';
import { docEditorLocales } from '@univerjs/univer-workspace-editor-presets/docs';
import { slideEditorLocales } from '@univerjs/univer-workspace-editor-presets/slides';
import { boardEditorLocales } from '@univerjs/univer-workspace-editor-presets/boards';
import { baseEditorLocales } from '@univerjs/univer-workspace-editor-presets/bases';
import docsEnUS from '@univerjs/preset-docs-core/locales/en-US';
import sheetsEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import docsDrawingEnUS from '@univerjs/preset-docs-drawing/locales/en-US';
import sheetsDrawingEnUS from '@univerjs/preset-sheets-drawing/locales/en-US';
import docCommentEnUS from '@univerjs/preset-docs-thread-comment/locales/en-US';
import sheetCommentEnUS from '@univerjs/preset-sheets-thread-comment/locales/en-US';
import collabEnUS from '@univerjs-pro/collaboration-client/locale/en-US';
import collabUIEnUS from '@univerjs-pro/collaboration-client-ui/locale/en-US';
import embedEnUS from '@univerjs-pro/embed-ui/locale/en-US';
import docHistoryEnUS from '@univerjs-pro/docs-history-ui/locale/en-US';
import slideHistoryEnUS from '@univerjs-pro/slides-history-ui/locale/en-US';
import boardHistoryEnUS from '@univerjs-pro/boards-history-ui/locale/en-US';
import baseHistoryEnUS from '@univerjs-pro/bases-history-ui/locale/en-US';
import docsZhCN from '@univerjs/preset-docs-core/locales/zh-CN';
import sheetsZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import docsDrawingZhCN from '@univerjs/preset-docs-drawing/locales/zh-CN';
import sheetsDrawingZhCN from '@univerjs/preset-sheets-drawing/locales/zh-CN';
import docCommentZhCN from '@univerjs/preset-docs-thread-comment/locales/zh-CN';
import sheetCommentZhCN from '@univerjs/preset-sheets-thread-comment/locales/zh-CN';
import collabZhCN from '@univerjs-pro/collaboration-client/locale/zh-CN';
import collabUIZhCN from '@univerjs-pro/collaboration-client-ui/locale/zh-CN';
import embedZhCN from '@univerjs-pro/embed-ui/locale/zh-CN';
import docHistoryZhCN from '@univerjs-pro/docs-history-ui/locale/zh-CN';
import slideHistoryZhCN from '@univerjs-pro/slides-history-ui/locale/zh-CN';
import boardHistoryZhCN from '@univerjs-pro/boards-history-ui/locale/zh-CN';
import baseHistoryZhCN from '@univerjs-pro/bases-history-ui/locale/zh-CN';

/** Load both dictionaries from the existing shared presets and registered extensions. */
export function editorLocales(type: string): Record<string, ILanguagePack> {
  return {
    [LocaleType.EN_US]: mergeLocales(
      docsEnUS, sheetsEnUS, sheetEditorLocales['en-US'],
      ...(type === 'doc' ? [docEditorLocales['en-US'], docHistoryEnUS] : []),
      ...(type === 'slide' ? [slideEditorLocales['en-US'], slideHistoryEnUS] : []),
      ...(type === 'board' ? [boardEditorLocales['en-US'], boardHistoryEnUS] : []),
      ...(type === 'base' ? [baseEditorLocales['en-US'], baseHistoryEnUS] : []),
      collabEnUS, collabUIEnUS, embedEnUS, docCommentEnUS, docsDrawingEnUS, sheetsDrawingEnUS, sheetCommentEnUS,
    ),
    [LocaleType.ZH_CN]: mergeLocales(
      docsZhCN, sheetsZhCN, sheetEditorLocales['zh-CN'],
      ...(type === 'doc' ? [docEditorLocales['zh-CN'], docHistoryZhCN] : []),
      ...(type === 'slide' ? [slideEditorLocales['zh-CN'], slideHistoryZhCN] : []),
      ...(type === 'board' ? [boardEditorLocales['zh-CN'], boardHistoryZhCN] : []),
      ...(type === 'base' ? [baseEditorLocales['zh-CN'], baseHistoryZhCN] : []),
      collabZhCN, collabUIZhCN, embedZhCN, docCommentZhCN, docsDrawingZhCN, sheetsDrawingZhCN, sheetCommentZhCN,
    ),
  };
}
