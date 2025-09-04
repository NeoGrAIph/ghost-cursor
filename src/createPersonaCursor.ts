import type { Page } from 'puppeteer'
import { createCursor, type GhostCursor } from './spoof'
import { PERSONAS, rngFromSession, compileOptions } from './personas'

export function createPersonaCursor (
  page: Page,
  personaId: keyof typeof PERSONAS,
  sessionId?: string,
  D = 500,
  W = 40,
  visible = false
): GhostCursor {
  const persona = PERSONAS[personaId]
  const rng = rngFromSession(sessionId ?? personaId)
  const opts = compileOptions(persona, rng, D, W)

  return createCursor(page, undefined, false, {
    move: opts.move,
    moveTo: {
      moveDelay: opts.move.moveDelay,
      randomizeMoveDelay: opts.move.randomizeMoveDelay,
      ...opts.path
    },
    click: { ...opts.move, ...opts.click },
    scroll: opts.scroll
  }, visible)
}

export { PERSONAS } from './personas'
