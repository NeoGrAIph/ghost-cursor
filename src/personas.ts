// src/personas.ts
export interface Tri { min: number, mode: number, max: number }
export interface Range { min: number, max: number }

export interface Persona {
  id: string
  label: string
  notes?: string
  fitts: { a_ms: number, b_ms_per_bit: number }
  dwell: Tri // hesitate (пауза перед кликом, мс)
  waitForClick: Range // промежуток между down/up, мс
  clickMoveDelay: Tri // задержка после клика, мс
  padding_pct: Tri // куда целиться внутри элемента, %
  overshootThreshold_px: Tri // порог "перелёта", px
  overshoot_rate: number // ожидаемая доля перелётов (для валидации)
  micro_jitter_px: Range // микро-сдвиги в покое, px
  doubleClick_ms: Tri // интервал двойного клика, мс
  doubleClick_drift_px: Range// микро-сдвиг между кликами, px
  scrollSpeed: Range // 70..90 — человеческий диапазон
  scrollDelay: Tri // пауза после скролла, мс
  maxTries: Range // число попыток наводки
  spreadOverride: Range // «живость» траектории (шаги от базовой)
}

// ---------- Seeded PRNG + распределения ----------
export function mulberry32 (seed: number) {
  return function () {
    let t = seed += 0x6D2B79F5
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function uniform (rng: () => number, a: number, b: number): number { return a + (b - a) * rng() }
export function tri (rng: () => number, t: Tri): number {
  const { min, mode, max } = t; const u = rng()
  const p = (mode - min) / (max - min)
  return u < p
    ? min + Math.sqrt(u * (max - min) * (mode - min))
    : max - Math.sqrt((1 - u) * (max - min) * (max - mode))
}
export function randint (rng: () => number, a: number, b: number): number { return Math.floor(uniform(rng, a, b + 1)) }

function hashString (s: string): number {
  const v = [...s].reduce((a, c) => (a * 131 + c.charCodeAt(0)) >>> 0, 0)
  return v === 0 ? 1 : v
}

// ---------- Каталог персон (v1) ----------

export const PERSONAS: Record<string, Persona> = {
  P1: {
    // Профиль «Стандарт»: среднестатистическое поведение курсора без крайностей.
    // Принципы распределений:
    // - { min, max } — равномерное распределение U[min, max]
    // - { min, mode, max } — треугольное распределение Tri(min, mode, max)

    id: 'P1', // Уникальный идентификатор профиля
    label: 'Стандарт', // Человекочитаемая метка профиля

    // Модель Фиттса (время наведения на цель):
    // T(ms) = a_ms + b_ms_per_bit * log2(D/W + 1),
    // где D — расстояние до цели (px), W — ширина цели (px).
    // `a_ms`: базовая задержка в миллисекундах. Постоянная часть времени перемещения, не зависящая от расстояния и размера цели.
    // Как влияет: `a_ms`: сдвигает всё время вверх на константу. Особенно заметно на лёгких движениях (близкие/крупные цели), где логарифмический член мал.
    // `b_ms_per_bit`: «скорость нарастания» времени на каждый бит сложности по закону Фиттса. Масштабирует вклад логарифмической части.
    // Как влияет: `b_ms_per_bit`: определяет, насколько чувствительно растёт время с усложнением задачи (дальше и/или меньше цель → больше ID). Влияет сильнее на «трудные» перемещения.
    // Чем дальше цель и чем она меньше, тем дольше наведение.
    fitts: { a_ms: 100, b_ms_per_bit: 174 },

    // «Задержка на цели» перед действием: время на выравнивание/прицеливание.
    // Треугольное распределение (мс): чаще всего около mode.
    dwell: { min: 120, mode: 170, max: 260 },

    // Пауза между завершением наведения и нажатием (mouseDown), мс.
    // Равномерное распределение: имитирует небольшую вариативность реакции.
    waitForClick: { min: 70, max: 120 },

    // Задержка перед началом следующего перемещения после клика, мс.
    // Треугольное распределение: пик в районе mode.
    clickMoveDelay: { min: 520, mode: 620, max: 760 },

    // Дополнительный «пэддинг» вокруг цели, в процентах её размера.
    // Снижает шанс касания кромок цели при прицеливании.
    padding_pct: { min: 10, mode: 15, max: 25 },

    // Порог расстояния, после которого допустимо «перелететь» цель (overshoot) и
    // затем скорректироваться. Единицы: пиксели.
    overshootThreshold_px: { min: 450, mode: 500, max: 650 },

    // Доля перемещений, где намеренно допускается лёгкий «перелёт» цели [0..1].
    // Небольшое значение имитирует человеческую инерцию без излишней заметности.
    overshoot_rate: 0.03,

    // Микродрожь (джиттер) курсора по пути, px. Равномерное распределение.
    // Малые значения добавляют «живости», не ломая траекторию.
    micro_jitter_px: { min: 0, max: 2 },

    // Интервал между кликами в двойном клике, мс. Треугольное распределение.
    // Позволяет реалистично эмулировать двойные клики.
    doubleClick_ms: { min: 300, mode: 500, max: 800 },

    // Случайный дрейф (смещение) между двумя кликами двойного клика, px.
    // Равномерное распределение: небольшие подвижки руки пользователя.
    doubleClick_drift_px: { min: 0, max: 2 },

    // Скорость прокрутки: «сила» одного шага wheel-события, px/шаг.
    // Равномерное распределение: чуть варьируем «сильнее/слабее» прокрутку.
    scrollSpeed: { min: 80, max: 90 },

    // Пауза между последовательными шагами прокрутки, мс. Треугольное распределение.
    // Делает скролл порционным и более «ручным».
    scrollDelay: { min: 180, mode: 230, max: 300 },

    // Лимит на количество попыток корректировок/повторных подходов к цели.
    // Равномерное распределение: небольшой разброс в терпеливости.
    maxTries: { min: 9, max: 11 },

    // Множитель «ширины»/разброса траектории (кривизна/шум пути).
    // Равномерное распределение: 1 — узко и аккуратно, 2 — шире и «живее».
    spreadOverride: { min: 1, max: 2 }
  },
  P2: {
    id: 'P2',
    label: 'Внимательный',
    fitts: { a_ms: 110, b_ms_per_bit: 185 },
    dwell: { min: 180, mode: 230, max: 320 },
    waitForClick: { min: 90, max: 140 },
    clickMoveDelay: { min: 650, mode: 750, max: 900 },
    padding_pct: { min: 15, mode: 20, max: 30 },
    overshootThreshold_px: { min: 420, mode: 470, max: 600 },
    overshoot_rate: 0.02,
    micro_jitter_px: { min: 0, max: 1 },
    doubleClick_ms: { min: 350, mode: 550, max: 850 },
    doubleClick_drift_px: { min: 0, max: 2 },
    scrollSpeed: { min: 78, max: 86 },
    scrollDelay: { min: 220, mode: 280, max: 340 },
    maxTries: { min: 10, max: 12 },
    spreadOverride: { min: 1, max: 3 }
  },
  P3: {
    id: 'P3',
    label: 'Быстрый',
    fitts: { a_ms: 90, b_ms_per_bit: 165 },
    dwell: { min: 90, mode: 120, max: 170 },
    waitForClick: { min: 60, max: 100 },
    clickMoveDelay: { min: 480, mode: 560, max: 640 },
    padding_pct: { min: 8, mode: 12, max: 18 },
    overshootThreshold_px: { min: 500, mode: 560, max: 700 },
    overshoot_rate: 0.04,
    micro_jitter_px: { min: 0, max: 3 },
    doubleClick_ms: { min: 250, mode: 450, max: 700 },
    doubleClick_drift_px: { min: 0, max: 3 },
    scrollSpeed: { min: 88, max: 92 },
    scrollDelay: { min: 160, mode: 200, max: 260 },
    maxTries: { min: 8, max: 10 },
    spreadOverride: { min: 1, max: 2 }
  },
  P4: {
    id: 'P4',
    label: 'Неуверенный',
    fitts: { a_ms: 115, b_ms_per_bit: 195 },
    dwell: { min: 200, mode: 270, max: 380 },
    waitForClick: { min: 90, max: 150 },
    clickMoveDelay: { min: 700, mode: 820, max: 980 },
    padding_pct: { min: 18, mode: 25, max: 35 },
    overshootThreshold_px: { min: 430, mode: 480, max: 580 },
    overshoot_rate: 0.05,
    micro_jitter_px: { min: 1, max: 4 },
    doubleClick_ms: { min: 320, mode: 520, max: 880 },
    doubleClick_drift_px: { min: 0, max: 4 },
    scrollSpeed: { min: 75, max: 82 },
    scrollDelay: { min: 240, mode: 300, max: 380 },
    maxTries: { min: 11, max: 13 },
    spreadOverride: { min: 2, max: 3 }
  },
  P5: {
    id: 'P5',
    label: 'Скроллер',
    fitts: { a_ms: 100, b_ms_per_bit: 174 },
    dwell: { min: 110, mode: 150, max: 220 },
    waitForClick: { min: 70, max: 120 },
    clickMoveDelay: { min: 520, mode: 600, max: 720 },
    padding_pct: { min: 10, mode: 15, max: 20 },
    overshootThreshold_px: { min: 450, mode: 520, max: 650 },
    overshoot_rate: 0.03,
    micro_jitter_px: { min: 0, max: 2 },
    doubleClick_ms: { min: 280, mode: 480, max: 780 },
    doubleClick_drift_px: { min: 0, max: 2 },
    scrollSpeed: { min: 85, max: 90 },
    scrollDelay: { min: 150, mode: 220, max: 280 },
    maxTries: { min: 9, max: 11 },
    spreadOverride: { min: 1, max: 2 }
  },
  P6: {
    id: 'P6',
    label: 'Торопливый',
    fitts: { a_ms: 95, b_ms_per_bit: 170 },
    dwell: { min: 100, mode: 130, max: 190 },
    waitForClick: { min: 60, max: 110 },
    clickMoveDelay: { min: 500, mode: 580, max: 700 },
    padding_pct: { min: 10, mode: 12, max: 15 },
    overshootThreshold_px: { min: 520, mode: 600, max: 720 },
    overshoot_rate: 0.06,
    micro_jitter_px: { min: 1, max: 3 },
    doubleClick_ms: { min: 240, mode: 420, max: 680 },
    doubleClick_drift_px: { min: 0, max: 3 },
    scrollSpeed: { min: 90, max: 92 },
    scrollDelay: { min: 150, mode: 200, max: 250 },
    maxTries: { min: 8, max: 10 },
    spreadOverride: { min: 1, max: 2 }
  },
  P7: {
    id: 'P7',
    label: 'Test super fast',
    fitts: { a_ms: 1, b_ms_per_bit: 1 },
    dwell: { min: 0, mode: 0, max: 0 },
    waitForClick: { min: 0, max: 0 },
    clickMoveDelay: { min: 0, mode: 0, max: 0 },
    padding_pct: { min: 100, mode: 100, max: 100 },
    overshootThreshold_px: { min: 4000, mode: 4000, max: 4000 },
    overshoot_rate: 0.00,
    micro_jitter_px: { min: 0, max: 0 },
    doubleClick_ms: { min: 0, mode: 0, max: 0 },
    doubleClick_drift_px: { min: 0, max: 0 },
    scrollSpeed: { min: 200, max: 200 },
    scrollDelay: { min: 0, mode: 0, max: 0 },
    maxTries: { min: 0, max: 0 },
    spreadOverride: { min: 1, max: 1 }
  }
}

// ---------- Утилиты Фиттса + компиляция опций ----------
export function fittsMT (D: number, W: number, a: number, b: number): number {
  return a + b * (Math.log2(D / W + 1))
}

export interface CompiledOptions {
  move: {
    paddingPercentage: number
    moveDelay: number
    randomizeMoveDelay: boolean
    overshootThreshold: number
    maxTries: number
  }
  click: {
    hesitate: number
    waitForClick: number
    moveDelay: number
  }
  scroll: {
    scrollSpeed: number
    scrollDelay: number
  }
  path: {
    spreadOverride: number
    useTimestamps: boolean
  }
  meta: {
    targetMT: number
  }
}

export function compileOptions (persona: Persona, rng: () => number, D: number, W: number): CompiledOptions {
  const dwell = Math.round(tri(rng, persona.dwell))
  const wfc = Math.round(uniform(rng, persona.waitForClick.min, persona.waitForClick.max))
  const padding = Math.round(tri(rng, persona.padding_pct))
  const moveDelay = Math.round(tri(rng, persona.clickMoveDelay))
  const overshootThreshold = Math.round(tri(rng, persona.overshootThreshold_px))
  const scrollDelay = Math.round(tri(rng, persona.scrollDelay))
  const scrollSpeed = Math.round(uniform(rng, persona.scrollSpeed.min, persona.scrollSpeed.max))
  const maxTries = Math.round(uniform(rng, persona.maxTries.min, persona.maxTries.max))
  const spread = Math.round(uniform(rng, persona.spreadOverride.min, persona.spreadOverride.max))
  const targetMT = fittsMT(D, W, persona.fitts.a_ms, persona.fitts.b_ms_per_bit)
  // Если у персоны «нулевая» задержка после клика (min=mode=max=0),
  // то и для обычных перемещений убираем искусственную задержку 0..40мс.
  // Для остальных профилей сохраняем небольшую случайную паузу между перемещениями.
  const zeroClickMoveDelay =
    persona.clickMoveDelay.min === 0 &&
    persona.clickMoveDelay.mode === 0 &&
    persona.clickMoveDelay.max === 0
  const moveDelayAfterMove = zeroClickMoveDelay ? 0 : Math.round(uniform(rng, 0, 40))

  return {
    move: { paddingPercentage: padding, moveDelay: moveDelayAfterMove, randomizeMoveDelay: !zeroClickMoveDelay, overshootThreshold, maxTries },
    click: { hesitate: dwell, waitForClick: wfc, moveDelay },
    scroll: { scrollSpeed, scrollDelay },
    path: { spreadOverride: spread, useTimestamps: true },
    meta: { targetMT }
  }
}

// Сахар: подготовить RNG по sessionId
export function rngFromSession (sessionId: string): () => number { return mulberry32(hashString(sessionId)) }
