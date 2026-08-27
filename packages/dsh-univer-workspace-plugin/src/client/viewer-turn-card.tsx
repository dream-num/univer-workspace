/**
 * The Turn-tail card: one compact row per Univer document this Turn opened or
 * created, mirroring the dsh-univer-office PreviewCard placement. The preview
 * button asks the floating viewer dock (via a window CustomEvent) to open the
 * document, keeping open-intent ownership inside the dock.
 * @module dsh-univer-workspace-plugin/client/viewer-turn-card
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ViewerOpenIntent } from './viewer-turn-definition.ts'
import { selectViewerTurn } from './viewer-turn-definition.ts'
import type { UwhLocaleKey } from './locales.ts'

/** Full card props: turn-tail runtime share + plugin locale seat + selection. */
export type ViewerTurnCardProps = PropsRuntime<'conversation.chat.turnTail'>
  & PropsLocale<'uwh'>
  & { readonly matched: readonly ViewerOpenIntent[] }

/** The window event the floating dock listens to for manual open requests. */
export const OPEN_VIEWER_EVENT = 'uwh:open-viewer'

/** Select this card only when the closing Turn carries viewer open intents. */
export const selectViewerTurnCard = selectViewerTurn

/** Render the per-Turn document card. */
export function ViewerTurnCard(props: ViewerTurnCardProps): React.ReactElement {
  return (
    <section className="uws-turn-card" aria-label={props.t('card.title')}>
      <span className="uws-turn-cardTitle">{props.t('card.title')}</span>
      <ul className="uws-turn-cardList">
        {props.matched.map(intent => (
          <li key={intent.unitId} className="uws-turn-cardRow">
            <span className="uws-turn-chip" data-unit-type={intent.unitType}>{intent.unitType}</span>
            <span className="uws-turn-cardName">{intent.name}</span>
            <span className="uws-turn-cardMode">{intent.readOnly ? props.t('card.readonly') : props.t('card.editable')}</span>
            <button
              type="button"
              className="uws-turn-cardOpen"
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_VIEWER_EVENT, { detail: intent }))}
            >
              {props.t('card.open')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
