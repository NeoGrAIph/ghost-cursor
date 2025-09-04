import type { Page } from 'puppeteer'
import { createCursor, type GhostCursor } from './spoof'
import { PERSONAS, rngFromSession, compileOptions } from './personas'

/**
 * Factory that builds a cursor using parameters from predefined personas.
 */
export const createPersonaCursor = (
  page: Page,
  personaId: keyof typeof PERSONAS,
  sessionId?: string,
  D = 500,
  W = 40,
  visible = false
): GhostCursor => {
  const persona = PERSONAS[personaId]
  if (persona === undefined) {
    throw new Error(`Unknown persona: ${personaId}`)
  }
  const rng = rngFromSession(sessionId ?? personaId)
  const opts = compileOptions(persona, rng, D, W)
  return createCursor(
    page,
    undefined,
    false,
    {
      // Пробрасываем path-опции (например, spreadOverride/useTimestamps) и в move,
      // чтобы конфигурация персоны влияла и на обычные перемещения, а не только на moveTo.
      move: { ...opts.move, ...opts.path },
      moveTo: { ...opts.move, ...opts.path },
      click: { ...opts.move, ...opts.click },
      scroll: opts.scroll
    },
    visible
  )
}

export { PERSONAS, rngFromSession, compileOptions }
