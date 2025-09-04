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
  // По умолчанию используем случайный сид, чтобы стартовая позиция (topBarX/topBarDrop)
  // и другие случайные параметры действительно варьировались между запусками.
  // Для воспроизводимости передайте явный sessionId.
  const randomSeed = `${personaId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const rng = rngFromSession(sessionId ?? randomSeed)
  const opts = compileOptions(persona, rng, D, W)
  const start = { x: Math.max(0, Math.round(opts.meta.topBarX ?? 0)), y: 0 }
  const cursor = createCursor(
    page,
    start,
    false,
    {
      // Пробрасываем path-опции и оригинальные распределения персоны,
      // чтобы рандом происходил на уровне каждого действия.
      move: {
        ...opts.move,
        ...opts.path,
        paddingTri: persona.padding_pct,
        overshootThresholdTri: persona.overshootThreshold_px,
        maxTriesRange: persona.maxTries
      },
      moveTo: { ...opts.move, ...opts.path },
      click: {
        ...opts.move,
        ...opts.click,
        hesitateTri: persona.dwell,
        waitForClickRange: persona.waitForClick,
        moveDelayTri: persona.clickMoveDelay
      },
      scroll: {
        ...opts.scroll,
        scrollDelayTri: persona.scrollDelay,
        wheelStepDelayTri: persona.wheelStepDelay_ms
      }
    },
    visible
  )
  // Лёгкий «съезд» вниз после появления (если задан)
  if ((opts.meta.topBarDrop ?? 0) > 0) {
    // fire-and-forget, чтобы не задерживать вызывающий код
    void cursor.moveBy({ y: opts.meta.topBarDrop })
  }
  return cursor
}

export { PERSONAS, rngFromSession, compileOptions }
