import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverUIPlugin } from '@univerjs/ui';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverDrawingPlugin } from '@univerjs/drawing';
import { UniverDrawingUIPlugin } from '@univerjs/drawing-ui';
import {
  UniverSlidesPlugin,
  SetSlideZoomRatioOperation,
} from '@univerjs-pro/slides';
import { UniverSlidesUIPlugin } from '@univerjs-pro/slides-ui';
import { UniverBoardsPlugin } from '@univerjs-pro/boards';
import { UniverBoardsUIPlugin } from '@univerjs-pro/boards-ui';
import { UniverBasesPlugin } from '@univerjs-pro/bases';
import { UniverBasesUIPlugin } from '@univerjs-pro/bases-ui';
import { UniverProFormulaEnginePlugin } from '@univerjs-pro/engine-formula';
import type { IPreset, IPresetPlugin } from '@univerjs/presets';
import '@univerjs-pro/slides/facade';
import '@univerjs-pro/bases/facade';
import '@univerjs-pro/boards/facade';
import slidesLocale from '@univerjs-pro/slides-ui/locale/zh-CN';
import boardsLocale from '@univerjs-pro/boards-ui/locale/zh-CN';
import basesLocale from '@univerjs-pro/bases-ui/locale/zh-CN';
import slidesCoreLocale from '@univerjs-pro/slides/locale/zh-CN';
export { SetSlideZoomRatioOperation };
export const officeLocales = [
  slidesCoreLocale,
  slidesLocale,
  boardsLocale,
  basesLocale,
];
/** Published SDK compositions. Advanced chart/mind/table stacks remain unbundled. */
export function officePreset(
  type: 'slide' | 'board' | 'base',
  container: HTMLElement,
): IPreset {
  const plugins: IPresetPlugin[] = [
    UniverRenderEnginePlugin,
    [
      UniverUIPlugin,
      {
        container,
        header: false,
        toolbar: false,
        footer: false,
        disableAutoFocus: true,
      },
    ],
    UniverDocsPlugin,
    [UniverDocsUIPlugin, { editor: { enabled: false } }],
    UniverDrawingPlugin,
    UniverDrawingUIPlugin,
  ];
  if (type === 'slide')
    plugins.push(UniverSlidesPlugin, [
      UniverSlidesUIPlugin,
      { editor: { enabled: true } },
    ]);
  if (type === 'board')
    plugins.push(UniverBoardsPlugin, [
      UniverBoardsUIPlugin,
      { showToolbar: false, workbench: { toolbar: false } },
    ]);
  if (type === 'base')
    plugins.push(
      [UniverProFormulaEnginePlugin, { notExecuteFormula: true }],
      UniverBasesPlugin,
      [
        UniverBasesUIPlugin,
        {
          disableEdit: true,
          workbench: { collaborationStatus: false, footer: false },
        },
      ],
    );
  return { plugins };
}
