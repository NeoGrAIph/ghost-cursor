/**
  * МОДУЛЬ ДЛЯ «ЧЕЛОВЕЧЕСКИХ» ДВИЖЕНИЙ КУРСОРА (Puppeteer)
  *
  * Идея простая: вы вызываете методы вроде move/click/scroll, а код ниже
  * строит реалистичную траекторию (по кривой Безье), отправляет события
  * в браузер через CDP и делает задержки, перелёты и т.п., чтобы поведение
  * было похоже на действия настоящего пользователя.
  *
  * Подсказки для ориентирования в файле:
  * - API курсора описано в интерфейсе GhostCursor (ниже по файлу).
  * - createCursor(...) — фабрика, создающая объект курсора.
  * - path(...) — генерация траектории между двумя точками.
  * - moveMouse(...) — низкоуровневое воспроизведение «mouseMoved» по траектории.
  */

// ======================================================================================
// === Раздел: Импорты и базовая инфраструктура ===
// Подключение зависимостей, math‑утилит и helper'а визуализации. Настройка логгера.
// ======================================================================================
import type { ElementHandle, Page, BoundingBox, CDPSession, Protocol } from 'puppeteer'
import debug from 'debug'
import {
  type Vector,
  type TimedVector,
  bezierCurve,
  bezierCurveSpeed,
  direction,
  magnitude,
  origin,
  overshoot,
  add,
  clamp,
  scale,
  extrapolate
} from './math'
import { installMouseHelper } from './mouse-helper'
import { PERSONAS, compileOptions, rngFromSession } from './personas'

export { installMouseHelper }

// Логгер для предупреждений/отладки (включается переменной окружения DEBUG=ghost-cursor)
const log = debug('ghost-cursor')

// ======================================================================================
// === Раздел: Типы и интерфейсы опций ===
// Контракты входных параметров для перемещения, кликов и прокрутки.
// ======================================================================================
export interface BoxOptions {
  /**
    * Процент отступа, добавляемого внутри элемента при определении целевой точки.
    * Пример:
    * - `0` = может быть где угодно внутри элемента.
    * - `100` = всегда будет в центре элемента.
    * @default 0
    */
  readonly paddingPercentage?: number
  /**
    * Точка назначения для перемещения курсора, относительно верхнего левого угла элемента.
    * Если указано, `paddingPercentage` не используется.
    * Если не указано (по умолчанию), точка назначения выбирается случайно внутри `paddingPercentage`.
    * @default undefined (случайная точка)
    */
  readonly destination?: Vector
}

export interface GetElementOptions {
  /**
    * Время ожидания появления селектора в миллисекундах.
    * По умолчанию ожидание селектора не производится.
    */
  readonly waitForSelector?: number
}

export interface ScrollOptions {
  /**
    * Скорость прокрутки. От 0 до 100. 100 — мгновенно.
    * @default 100
    */
  readonly scrollSpeed?: number
  /**
    * Время ожидания после прокрутки.
    * @default 200
    */
  readonly scrollDelay?: number
}

export interface ScrollIntoViewOptions extends ScrollOptions, GetElementOptions {
  /**
    * Скорость прокрутки (когда прокрутка происходит). От 0 до 100. 100 — мгновенно.
    * @default 100
    */
  readonly scrollSpeed?: number
  /**
    * Время ожидания после прокрутки (если прокрутка произошла).
    * @default 200
    */
  readonly scrollDelay?: number
  /**
    * Отступ (в пикселях), добавляемый вокруг элемента при обеспечении его видимости в области просмотра.
    * (Не применяется, если прокрутка через CDP не удалась.)
    * @default 0
    */
  readonly inViewportMargin?: number
}

export interface MoveOptions extends BoxOptions, ScrollIntoViewOptions, Pick<PathOptions, 'moveSpeed'> {
  /**
    * Задержка после перемещения мыши в миллисекундах. Если `randomizeMoveDelay=true`, задержка выбирается случайным образом от 0 до `moveDelay`.
    * @default 0
    */
  readonly moveDelay?: number
  /**
    * Рандомизация задержки между действиями от `0` до `moveDelay`. См. документацию `moveDelay`.
    * @default true
    */
  readonly randomizeMoveDelay?: boolean
  /**
    * Максимальное количество попыток навести курсор на элемент.
    * @default 10
    */
  readonly maxTries?: number
  /**
    * Расстояние от текущего местоположения до точки назначения, при котором срабатывает «перелёт». (Если расстояние меньше, «перелёт» не происходит).
    * @default 500
    */
  readonly overshootThreshold?: number
}

export interface ClickOptions extends MoveOptions {
  /**
    * Задержка перед началом действия клика в миллисекундах.
    * @default 0
    */
  readonly hesitate?: number
  /**
    * Задержка между нажатием и отпусканием кнопки мыши в миллисекундах.
    * @default 0
    */
  readonly waitForClick?: number
  /**
    * @default 2000
    */
  readonly moveDelay?: number
  /**
    * @default "left"
    */
  readonly button?: Protocol.Input.MouseButton
  /**
    * @default 1
    */
  readonly clickCount?: number
}

export interface PathOptions {
  /**
    * Переопределяет разброс сгенерированного пути.
    */
  readonly spreadOverride?: number
  /**
    * Скорость движения мыши.
    * По умолчанию случайная.
    */
  readonly moveSpeed?: number

  /**
    * Генерация временных меток для каждой точки пути.
    */
  readonly useTimestamps?: boolean
}

export interface RandomMoveOptions extends Pick<MoveOptions, 'moveDelay' | 'randomizeMoveDelay' | 'moveSpeed'> {
  /**
    * @default 2000
    */
  readonly moveDelay?: number
}

export interface MoveToOptions extends PathOptions, Pick<MoveOptions, 'moveDelay' | 'randomizeMoveDelay'> {
  /**
    * @default 0
    */
  readonly moveDelay?: number
}

export type ScrollToDestination = Partial<Vector> | 'top' | 'bottom' | 'left' | 'right'

export type MouseButtonOptions = Pick<ClickOptions, 'button' | 'clickCount'>

/**
  * Параметры по умолчанию для функций курсора.
  */
export interface DefaultOptions {
  /**
    * Параметры по умолчанию для функции `randomMove`, которая выполняется, если `performRandomMoves=true`
    * @default RandomMoveOptions
    */
  randomMove?: RandomMoveOptions
  /**
    * Параметры по умолчанию для функции `move`
    * @default MoveOptions
    */
  move?: MoveOptions
  /**
    * Параметры по умолчанию для функции `moveTo`
    * @default MoveToOptions
    */
  moveTo?: MoveToOptions
  /**
    * Параметры по умолчанию для функции `click`
    * @default ClickOptions
    */
  click?: ClickOptions
  /**
    * Параметры по умолчанию для функций `scrollIntoView`, `scrollTo`, и `scroll`
    * @default ScrollIntoViewOptions
    */
  scroll?: ScrollOptions & ScrollIntoViewOptions
  /**
    * Параметры по умолчанию для функции `getElement`
    * @default GetElementOptions
    */
  getElement?: GetElementOptions
}

// ======================================================================================
// === Раздел: Публичное API курсора ===
// Интерфейс действий, доступных внешнему коду.
// ======================================================================================
/**
  * Публичное API курсора, которым пользуется внешний код.
  * Каждая операция внутри аккуратно синхронизирована и использует CDP.
  */
export interface GhostCursor {
  /** Включает или отключает случайные движения мыши. */
  toggleRandomMove: (random: boolean) => void
  /** Симулирует клик мыши по указанному селектору или элементу. */
  click: (
    selector?: string | ElementHandle,
    /** @default defaultOptions.click */
    options?: ClickOptions
  ) => Promise<void>
  /** Перемещает курсор к указанному селектору или элементу. */
  move: (
    selector: string | ElementHandle,
    /** @default defaultOptions.move */
    options?: MoveOptions
  ) => Promise<void>
  /** Перемещает курсор к указанной точке назначения. */
  moveTo: (
    destination: Vector,
    /** @default defaultOptions.moveTo */
    options?: MoveToOptions) => Promise<void>
  /** Перемещает курсор на указанное расстояние */
  moveBy: (
    delta: Partial<Vector>,
    options?: MoveToOptions
  ) => Promise<void>
  /** Доводит элемент до видимой области. Если элемент уже виден — ничего не делает. */
  scrollIntoView: (
    selector: ElementHandle,
    /** @default defaultOptions.scroll */
    options?: ScrollIntoViewOptions) => Promise<void>
  /** Прокручивает документ к указанной точке/краю. */
  scrollTo: (
    destination: ScrollToDestination,
    /** @default defaultOptions.scroll */
    options?: ScrollOptions) => Promise<void>
  /** Прокручивает страницу на заданную `delta`. */
  // RU: Прокручивает страницу на заданную дельту по осям X/Y.
  scroll: (
    delta: Partial<Vector>,
    /** @default defaultOptions.scroll */
    options?: ScrollOptions) => Promise<void>
  /** Нажатие кнопки мыши */
  mouseDown: (options?: MouseButtonOptions) => Promise<void>
  /** Отпускание кнопки мыши */
  mouseUp: (options?: MouseButtonOptions) => Promise<void>
  /** Получает элемент по селектору; поддерживается XPath. */
  getElement: (
    selector: string | ElementHandle,
    /** @default defaultOptions.getElement */
    options?: GetElementOptions) => Promise<ElementHandle<Element>>
  /** Получает текущее положение курсора. */
  getLocation: () => Vector
  /**
    * Делает курсор «невидимым».
    * Если при создании курсора включали `visible=true`.
    */
  removeMouseHelper?: Promise<() => Promise<void>>
}

// ======================================================================================
// === Раздел: Вспомогательные утилиты и работа с CDP ===
// Пауза, формула Фиттса, выбор точки, доступ к CDP и надёжное получение рамок элементов.
// ======================================================================================
/**
  * Простой helper: неблокирующая пауза на указанное количество миллисекунд.
  */
const delay = async (ms: number): Promise<void> => {
  if (ms < 1) return
  return await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
  * Рассчитывает время, необходимое для перемещения от (x1, y1) до (x2, y2),
  * учитывая ширину элемента, на который производится клик.
  * https://ru.wikipedia.org/wiki/Закон_Фиттса
  */
// Оценка сложности/времени по закону Фиттса: дальше/уже — дольше
const fitts = (distance: number, width: number): number => {
  const a = 0
  const b = 2
  const id = Math.log2(distance / width + 1)
  return a + b * id
}

/** Случайная точка внутри прямоугольника элемента (учитывается paddingPercentage) */
const getRandomBoxPoint = (
  { x, y, width, height }: BoundingBox,
  options?: Pick<BoxOptions, 'paddingPercentage'>
): Vector => {
  let paddingWidth = 0
  let paddingHeight = 0

  if (
    options?.paddingPercentage !== undefined &&
    options?.paddingPercentage > 0 &&
    options?.paddingPercentage <= 100
  ) {
    paddingWidth = (width * options.paddingPercentage) / 100
    paddingHeight = (height * options.paddingPercentage) / 100
  }

  return {
    x: x + paddingWidth / 2 + Math.random() * (width - paddingWidth),
    y: y + paddingHeight / 2 + Math.random() * (height - paddingHeight)
  }
}

/** Доступ к CDP-клиенту Puppeteer (учтены различия версий 14.4.1+) */
export const getCDPClient = (page: Page): CDPSession =>
  typeof (page as any)._client === 'function'
    ? (page as any)._client()
    : (page as any)._client

/** Случайная точка внутри окна браузера (для случайных «бродящих» движений) */
export const getRandomPagePoint = async (page: Page): Promise<Vector> => {
  const targetId: string = (page.target() as any)._targetId
  const window = await getCDPClient(page).send('Browser.getWindowForTarget', { targetId })
  return getRandomBoxPoint({
    x: origin.x,
    y: origin.y,
    width: window.bounds.width ?? 0,
    height: window.bounds.height ?? 0
  })
}

/** Точное получение рамки inline‑элементов через CDP; есть надёжные фоллбеки */
export const getElementBox = async (
  page: Page,
  element: ElementHandle,
  relativeToMainFrame: boolean = true): Promise<BoundingBox> => {
  try {
    const objectId = element.remoteObject().objectId
    if (objectId === undefined) throw new Error('Element objectId is undefined, falling back to alternative methods')

    const quads = await getCDPClient(page).send('DOM.getContentQuads', { objectId })
    const elementBox: BoundingBox = {
      x: quads.quads[0][0],
      y: quads.quads[0][1],
      width: quads.quads[0][4] - quads.quads[0][0],
      height: quads.quads[0][5] - quads.quads[0][1]
    }
    if (!relativeToMainFrame) {
      const elementFrame = await element.contentFrame()
      const iframes = await elementFrame?.parentFrame()?.$$('xpath/.//iframe')
      if (iframes !== undefined && iframes !== null) {
        let frame: ElementHandle<Node> | undefined
        for (const iframe of iframes) {
          if ((await iframe.contentFrame()) === elementFrame) {
            frame = iframe
          }
        }
        if (frame !== undefined && frame != null) {
          const frameBox = await frame.boundingBox()
          if (frameBox !== null) {
            elementBox.x -= frameBox.x
            elementBox.y -= frameBox.y
          }
        }
      }
    }

    return elementBox
  } catch {
    try {
      log('Quads not found, trying regular boundingBox')
      const elementBox = await element.boundingBox()
      if (elementBox === null) throw new Error('Element boundingBox is null, falling back to getBoundingClientRect')
      return elementBox
    } catch {
      log('BoundingBox null, using getBoundingClientRect')
      return await element.evaluate((el) =>
        el.getBoundingClientRect() as BoundingBox
      )
    }
  }
}

// ======================================================================================
// === Раздел: Генерация траектории движения ===
// Кривая Безье, оценка «сложности» (Фиттс), вычисление числа шагов, временные метки.
// ======================================================================================
/**
  * Генерация траектории движения:
  * - строим кривую Безье между start и end;
  * - считаем длину пути и «сложность» цели (Fitts);
  * - подбираем число шагов (steps): чем сложнее/дальше, тем больше точек;
  * - возвращаем массив точек, по которым потом пройдётся курсор.
  */
export function path (
  start: Vector,
  end: Vector | BoundingBox,
  /**
    * Дополнительные параметры для генерации траектории.
    * Может быть числом, которое задаёт `spreadOverride`.
    */
  // TODO: удалить аргумент number в следующем мажорном изменении версии, достаточно просто разрешить `spreadOverride` в объекте.
  options?: number | PathOptions): Vector[] | TimedVector[] {
  const optionsResolved: PathOptions = typeof options === 'number'
    ? { spreadOverride: options }
    : { ...options }

  const DEFAULT_WIDTH = 100
  const MIN_STEPS = 25
  const width = 'width' in end && end.width !== 0 ? end.width : DEFAULT_WIDTH
  const curve = bezierCurve(start, end, optionsResolved.spreadOverride)
  const length = curve.length() * 0.8

  // Чем больше moveSpeed, тем быстрее движение (меньше времени на путь)
  const speed = optionsResolved.moveSpeed !== undefined && optionsResolved.moveSpeed > 0
    ? (25 / optionsResolved.moveSpeed)
    : Math.random()
  const baseTime = speed * MIN_STEPS
  const steps = Math.ceil((Math.log2(fitts(length, width) + 1) + baseTime) * 3)
  const re = curve.getLUT(steps)
  return clampPositive(re, optionsResolved)
}

// Не допускаем отрицательных координат; при необходимости добавляем метки времени
const clampPositive = (vectors: Vector[], options?: PathOptions): Vector[] | TimedVector[] => {
  const clampedVectors = vectors.map((vector) => ({
    x: Math.max(0, vector.x),
    y: Math.max(0, vector.y)
  }))

  return options?.useTimestamps === true ? generateTimestamps(clampedVectors, options) : clampedVectors
}

// Генерируем «правдоподобные» временные метки между соседними точками пути
const generateTimestamps = (vectors: Vector[], options?: PathOptions): TimedVector[] => {
  const speed = options?.moveSpeed ?? (Math.random() * 0.5 + 0.5)
  const timeToMove = (P0: Vector, P1: Vector, P2: Vector, P3: Vector, samples: number): number => {
    let total = 0
    const dt = 1 / samples

    for (let t = 0; t < 1; t += dt) {
      const v1 = bezierCurveSpeed(t * dt, P0, P1, P2, P3)
      const v2 = bezierCurveSpeed(t, P0, P1, P2, P3)
      total += (v1 + v2) * dt / 2
    }

    return Math.round(total / speed) // миллисекунды на участок
  }

  const timedVectors: TimedVector[] = []

  for (let i = 0; i < vectors.length; i++) {
    if (i === 0) {
      timedVectors.push({ ...vectors[i], timestamp: Date.now() })
    } else {
      const P0 = vectors[i - 1]
      const P1 = vectors[i]
      const P2 = i + 1 < vectors.length ? vectors[i + 1] : extrapolate(P0, P1)
      const P3 = i + 2 < vectors.length ? vectors[i + 2] : extrapolate(P1, P2)
      const time = timeToMove(P0, P1, P2, P3, vectors.length)

      timedVectors.push({
        ...vectors[i],
        timestamp: timedVectors[i - 1].timestamp + time
      })
    }
  }

  return timedVectors
}

const shouldOvershoot = (a: Vector, b: Vector, threshold: number): boolean =>
  magnitude(direction(a, b)) > threshold

const intersectsElement = (vec: Vector, box: BoundingBox): boolean => {
  return (
    vec.x > box.x &&
    vec.x <= box.x + box.width &&
    vec.y > box.y &&
    vec.y <= box.y + box.height
  )
}

// ======================================================================================
// === Раздел: Фабрика и реализация курсора ===
// Создаёт объект GhostCursor: состояние, внутренние helper'ы и публичные действия.
// ======================================================================================
/**
  * Фабрика курсора: хранит текущее положение и возвращает набор действий.
  */
export const createCursor = (
  page: Page,
  /**
    * Cursor start position.
    * @default { x: 0, y: 0 }
    */
  start: Vector = origin,
  /**
    * Изначально выполняет случайные движения.
    * Если выполняются `move`, `click` и т.п., эти случайные движения прекращаются.
    * @default false
    */
  performRandomMoves: boolean = false,
  /**
    * Параметры по умолчанию для функций курсора.
    */
  defaultOptions: DefaultOptions = {},
  /**
    * Должен ли курсор быть видимым с использованием `installMouseHelper`.
    * @default false
    */
  visible: boolean = false
): GhostCursor => {
  // ======================================================================================
  // -- Состояние курсора и параметры «перелёта»
  // ======================================================================================
  // Имитируем инерцию руки: перелёт за цель и возврат узкой дугой.
  // Параметры «перелёта»: сначала пролетаем чуть дальше цели (радиус),
  // потом возвращаемся более узкой дугой (spread), чтобы имитировать инерцию руки
  const OVERSHOOT_SPREAD = 10
  const OVERSHOOT_RADIUS = 120
  /** Текущее положение курсора (обновляется после каждого шага) */
  let location: Vector = start

  // Initial state: mouse is not moving
  let moving: boolean = false
  // ======================================================================================
  // -- Helper: moveMouse(...)
  // Плавно воспроизводит 'mouseMoved' по сгенерированной траектории; поддерживает timestamps и аварийную остановку фоновых движений.
  // ======================================================================================
  /**
    * Отправка «mouseMoved» по всем точкам траектории, с обработкой ошибок.
    */
  const moveMouse = async (
    newLocation: Vector | BoundingBox,
    options?: PathOptions,
    abortOnMove: boolean = false
  ): Promise<void> => {
    const cdpClient = getCDPClient(page)
    const vectors = path(location, newLocation, options)

    for (const v of vectors) {
      try {
        // Если это вызвано случайными движениями мыши, и пользователь хочет переместить мышь, прервать выполнение
        if (abortOnMove && moving) {
          return
        }

        const dispatchParams: Protocol.Input.DispatchMouseEventRequest = {
          type: 'mouseMoved',
          x: v.x,
          y: v.y
        }

        if ('timestamp' in v) dispatchParams.timestamp = v.timestamp

        await cdpClient.send('Input.dispatchMouseEvent', dispatchParams)

        location = v
      } catch (error) {
        // Exit function if the browser is no longer connected
        if (!page.browser().isConnected()) return

        log('Warning: could not move mouse, error message:', error)
      }
    }
  }

  // ======================================================================================
  // -- Helper: randomMove(...)
  // Фоновое «брожение»: курсор периодически двигается к случайной точке окна.
  // ======================================================================================
  /**
    * Случайные перемещения курсора ("брожение"): раз в moveDelay берём
    * случайную точку в пределах окна и плавно перемещаемся к ней. Как только
    * начинается явное действие (move/click), «брожение» прекращается.
    */
  const randomMove = async (options?: RandomMoveOptions): Promise<void> => {
    const optionsResolved = {
      moveDelay: 2000,
      randomizeMoveDelay: true,
      ...defaultOptions?.randomMove,
      ...options
    } satisfies RandomMoveOptions

    try {
      if (!moving) {
        const rand = await getRandomPagePoint(page)
        await moveMouse(rand, optionsResolved, true)
      }
      await delay(optionsResolved.moveDelay * (optionsResolved.randomizeMoveDelay ? Math.random() : 1))
      randomMove(options).then(
        (_) => { },
        (_) => { }
      ) // fire and forget, recursive function
    } catch (_) {
      log('Warning: stopping random mouse movements')
    }
  }

  // ======================================================================================
  // -- Helper: mouseButtonAction(...)
  // Обёртка над Input.dispatchMouseEvent для mousePressed/mouseReleased.
  // ======================================================================================
  const mouseButtonAction = async (
    action: Protocol.Input.DispatchMouseEventRequest['type'],
    options?: MouseButtonOptions
  ): Promise<void> => {
    const optionsResolved = {
      button: 'left',
      clickCount: 1,
      ...defaultOptions?.click,
      ...options
    } satisfies MouseButtonOptions

    const cdpClient = getCDPClient(page)
    await cdpClient.send('Input.dispatchMouseEvent', {
      x: location.x,
      y: location.y,
      button: optionsResolved.button,
      clickCount: optionsResolved.clickCount,
      type: action
    })
  }

  // ======================================================================================
  // -- Публичные действия курсора (реализация интерфейса)
  // ======================================================================================
  const actions: GhostCursor = {
    // --- Служебные методы: управление состоянием и текущими координатами
    /** Включает или отключает случайные движения мыши. */
    toggleRandomMove (random: boolean): void {
      moving = !random
    },

    /** Получить текущее местоположение курсора. */
    getLocation (): Vector {
      return location
    },
    // ======================================================================================
    // --- Взаимодействие: click / mouseDown / mouseUp
    // ======================================================================================
    /**
      * Клик по селектору/элементу: подвод курсора (при необходимости) → down → up.
      */
    async click (
      selector?: string | ElementHandle,
      options?: ClickOptions
    ): Promise<void> {
      const optionsResolved = {
        moveDelay: 2000,
        hesitate: 0,
        waitForClick: 0,
        randomizeMoveDelay: true,
        button: 'left',
        clickCount: 1,
        ...defaultOptions?.click,
        ...options
      } satisfies ClickOptions

      const wasRandom = !moving
      actions.toggleRandomMove(false)

      if (selector !== undefined) {
        await actions.move(selector, {
          ...optionsResolved,
          // применить задержку moveDelay после клика, но не после фактического перемещения
          moveDelay: 0
        })
      }

      try {
        await delay(optionsResolved.hesitate)

        await this.mouseDown()
        await delay(optionsResolved.waitForClick)
        await this.mouseUp()
      } catch (error) {
        log('Warning: could not click mouse, error message:', error)
      }

      await delay(optionsResolved.moveDelay * (optionsResolved.randomizeMoveDelay ? Math.random() : 1))

      actions.toggleRandomMove(wasRandom)
    },

    /** Нажатие кнопки мыши */
    async mouseDown (options?: MouseButtonOptions): Promise<void> {
      await mouseButtonAction('mousePressed', options)
    },

    /** Отпускание кнопки мыши */
    async mouseUp (options?: MouseButtonOptions): Promise<void> {
      await mouseButtonAction('mouseReleased', options)
    },
    // ======================================================================================
    // --- Наведение и перемещение: move / moveTo / moveBy
    // ======================================================================================
    /** Перемещение к селектору/элементу (повтор, если цель «уехала»). */
    async move (
      selector: string | ElementHandle,
      options?: MoveOptions
    ): Promise<void> {
      const optionsResolved = {
        moveDelay: 0,
        maxTries: 10,
        overshootThreshold: 500,
        randomizeMoveDelay: true,
        ...defaultOptions?.move,
        ...options
      } satisfies MoveOptions

      const wasRandom = !moving
      actions.toggleRandomMove(false)

      const go = async (iteration: number): Promise<void> => {
        if (iteration > (optionsResolved.maxTries)) {
          throw Error('Could not mouse-over element within enough tries')
        }

        const elem = await this.getElement(selector, optionsResolved)

        // Убедитесь, что объект находится в области видимости
        await this.scrollIntoView(elem, optionsResolved)

        const box = await getElementBox(page, elem)
        const destination = (optionsResolved.destination !== undefined)
          ? add(box, optionsResolved.destination)
          : getRandomBoxPoint(box, optionsResolved)
        // Решаем, делать ли «перелёт» (если цель далеко) — так движения выглядят менее «идеальными» и более живыми
        if (shouldOvershoot(
          location,
          destination,
          optionsResolved.overshootThreshold
        )) {
          // Шаг 1: «перелёт» за цель (слегка промахиваемся)
          await moveMouse(overshoot(destination, OVERSHOOT_RADIUS), optionsResolved)

          // Шаг 2: возвращаемся к цели более узкой дугой
          await moveMouse({ ...box, ...destination }, {
            ...optionsResolved,
            spreadOverride: OVERSHOOT_SPREAD
          })
        } else {
          // Иначе идём прямо к цели без «перелёта»
          await moveMouse(destination, optionsResolved)
        }

        const newBoundingBox = await getElementBox(page, elem)

        // Важно: элемент за время анимации может сдвинуться.
        // Если в конце не попали в его рамки — пробуем ещё раз.
        if (!intersectsElement(location, newBoundingBox)) {
          return await go(iteration + 1)
        }
      }
      await go(0)

      actions.toggleRandomMove(wasRandom)

      await delay(optionsResolved.moveDelay * (optionsResolved.randomizeMoveDelay ? Math.random() : 1))
    },

    /** Перемещает мышь к указанной точке назначения. */
    async moveTo (
      destination: Vector,
      options?: MoveToOptions
    ): Promise<void> {
      const optionsResolved = {
        moveDelay: 0,
        randomizeMoveDelay: true,
        ...defaultOptions?.moveTo,
        ...options
      } satisfies MoveToOptions

      const wasRandom = !moving
      actions.toggleRandomMove(false)
      await moveMouse(destination, optionsResolved)
      actions.toggleRandomMove(wasRandom)

      await delay(optionsResolved.moveDelay * (optionsResolved.randomizeMoveDelay ? Math.random() : 1))
    },

    /** Перемещает курсор на заданную величину */
    async moveBy (delta: Partial<Vector>, options?: MoveToOptions): Promise<void> {
      await this.moveTo(add(location, { x: 0, y: 0, ...delta }), options)
    },
    // ======================================================================================
    // --- Прокрутка: scrollIntoView / scroll / scrollTo
    // ======================================================================================
    /** Прокручивает элемент до видимой области. Если элемент уже виден — ничего не делает. */
    async scrollIntoView (
      selector: string | ElementHandle,
      options?: ScrollIntoViewOptions
    ): Promise<void> {
      const optionsResolved = {
        scrollDelay: 200,
        scrollSpeed: 100,
        inViewportMargin: 0,
        ...defaultOptions?.scroll,
        ...options
      } satisfies ScrollIntoViewOptions

      const scrollSpeed = clamp(optionsResolved.scrollSpeed, 1, 100)

      const elem = await this.getElement(selector, optionsResolved)

      const {
        viewportWidth,
        viewportHeight,
        docHeight,
        docWidth,
        scrollPositionTop,
        scrollPositionLeft
      } = await page.evaluate(() => (
        {
          viewportWidth: document.body.clientWidth,
          viewportHeight: document.body.clientHeight,
          docHeight: document.body.scrollHeight,
          docWidth: document.body.scrollWidth,
          scrollPositionTop: window.scrollY,
          scrollPositionLeft: window.scrollX
        }
      ))

      const elemBoundingBox = await getElementBox(page, elem) // is relative to viewport
      const elemBox = {
        top: elemBoundingBox.y,
        left: elemBoundingBox.x,
        bottom: elemBoundingBox.y + elemBoundingBox.height,
        right: elemBoundingBox.x + elemBoundingBox.width
      }

      // Добавить `margin` вокруг элемента.

      /** В контексте Ghost Cursor “margin” — это допуск вокруг`bounding box` элемента, задаваемый опцией `inViewportMargin` при `scrollIntoView`.
        * Назначение: расширить прямоугольник элемента на `inViewportMargin` пикселей со всех сторон, чтобы считать элемент «в зоне видимости», даже если он близко к краю экрана.
        * Где используется: `scrollIntoView` строит `marginedBox` из `elemBox`, прибавляя/вычитая `inViewportMargin` (см. ghost-cursor/src/spoof.ts:817–823).
        * Дополнительная логика: расширенный прямоугольник приводится к координатам всего документа и «зажимается» в его границах, затем обратно переводится к `viewport` (см. :825–842). Это предотвращает ложные отрицательные координаты и выход за docWidth/docHeight.
        * Итог проверки: если такой расширенный `targetBox` целиком в пределах `viewport`, прокрутка не выполняется (isInViewport === true, см. :846–851).
        * Коротко: margin здесь — не CSS-свойство элемента, а числовой отступ (buffer) в пикселях для вычислений видимости при автопрокрутке.
        */
      const marginedBox = {
        top: elemBox.top - optionsResolved.inViewportMargin,
        left: elemBox.left - optionsResolved.inViewportMargin,
        bottom: elemBox.bottom + optionsResolved.inViewportMargin,
        right: elemBox.right + optionsResolved.inViewportMargin
      }

      // Получить положение относительно всего документа.
      const marginedBoxRelativeToDoc = {
        top: marginedBox.top + scrollPositionTop,
        left: marginedBox.left + scrollPositionLeft,
        bottom: marginedBox.bottom + scrollPositionTop,
        right: marginedBox.right + scrollPositionLeft
      }

      // Преобразовать обратно к координатам относительно `viewport`--
      // если `box` с добавленным `margin` выходит за пределы `document`, ограничить его границами `document`.
      // Даже если элемент на самом краю экрана, мы всё равно считаем его видимым (isInViewport=true), даже с учётом `margin`.
      /**
        * Преобразовать координаты обратно относительно `viewport`. Если `box` с добавленным `margin` выходит за пределы `document`, «зажать» его внутри границ `document`. Это нужно, чтобы когда элемент на самом краю области прокрутки окна, `isInViewport` оставалось true даже после применения `margin`.
        * Пояснения:
        *   `viewport` - видимая область окна браузера.
        *   `document` - вся страница целиком, включая невидимые части за пределами экрана.
        *   `box` - прямоугольник элемента (его bounding box). К нему добавляют margin, чтобы считать не только строго видимую часть, но и «зону вокруг».
        *
        * Зачем «зажимать» в `document`: если после добавления margin прямоугольник ушёл за границы страницы (например, координаты стали отрицательными или больше размеров документа), мы корректируем их, иначе проверка на видимость будет некорректной.
        * Пример:
        *   Элемент вплотную к верхнему краю. Добавили `margin=10`, верхняя граница стала `y=-10`. Мы поднимаем её до `y=0`, чтобы логика `isInViewport` работала предсказуемо.
        */
      const targetBox = {
        top: Math.max(marginedBoxRelativeToDoc.top, 0) - scrollPositionTop,
        left: Math.max(marginedBoxRelativeToDoc.left, 0) - scrollPositionLeft,
        bottom: Math.min(marginedBoxRelativeToDoc.bottom, docHeight) - scrollPositionTop,
        right: Math.min(marginedBoxRelativeToDoc.right, docWidth) - scrollPositionLeft
      }

      const { top, left, bottom, right } = targetBox

      const isInViewport = top >= 0 &&
        left >= 0 &&
        bottom <= viewportHeight &&
        right <= viewportWidth

      if (isInViewport) return

      const manuallyScroll = async (): Promise<void> => {
        let deltaY: number = 0
        let deltaX: number = 0

        if (top < 0) {
          deltaY = top // Scroll up
        } else if (bottom > viewportHeight) {
          deltaY = bottom - viewportHeight // Scroll down
        }

        if (left < 0) {
          deltaX = left // Scroll left
        } else if (right > viewportWidth) {
          deltaX = right - viewportWidth// Scroll right
        }

        await this.scroll({ x: deltaX, y: deltaY }, optionsResolved)
      }

      try {
        const cdpClient = getCDPClient(page)

        if (scrollSpeed === 100 && optionsResolved.inViewportMargin <= 0) {
          try {
            const { objectId } = elem.remoteObject()
            if (objectId === undefined) throw new Error()
            await cdpClient.send('DOM.scrollIntoViewIfNeeded', { objectId })
          } catch {
            await manuallyScroll()
          }
        } else {
          await manuallyScroll()
        }
      } catch (e) {
        // use regular JS scroll method as a fallback
        log('Falling back to JS scroll method', e)
        await elem.evaluate((e) => e.scrollIntoView({
          block: 'center',
          behavior: scrollSpeed < 90 ? 'smooth' : undefined
        }))
      }
    },

    /**
      * Прокрутка страницы на заданную дельту.
      * Алгоритм: вычисляем, по какой оси путь длиннее, и делим весь путь
      * на шаги. Чем «быстрее» scrollSpeed, тем крупнее шаги и меньше их число.
      */
    async scroll (
      delta: Partial<Vector>,
      options?: ScrollOptions
    ): Promise<void> {
      const optionsResolved = {
        scrollDelay: 200,
        scrollSpeed: 100,
        ...defaultOptions?.scroll,
        ...options
      } satisfies ScrollOptions

      const scrollSpeed = clamp(optionsResolved.scrollSpeed, 1, 100)

      const cdpClient = getCDPClient(page)

      let deltaX = delta.x ?? 0
      let deltaY = delta.y ?? 0
      const xDirection = deltaX < 0 ? -1 : 1
      const yDirection = deltaY < 0 ? -1 : 1

      deltaX = Math.abs(deltaX)
      deltaY = Math.abs(deltaY)

      const largerDistanceDir = deltaX > deltaY ? 'x' : 'y'
      const [largerDistance, shorterDistance] = largerDistanceDir === 'x' ? [deltaX, deltaY] : [deltaY, deltaX]

      // Когда scrollSpeed < 90, число пикселей за один шаг прокрутки равно значению scrollSpeed. 1 — это максимально медленно (без добавления задержки), а 90 — уже довольно быстро.
      // При значении > 90 масштабируем на всю оставшуюся дистанцию, так что при scrollSpeed=100 выполняется всего одно действие прокрутки.
      const EXP_SCALE_START = 90 // выше этого ускоряемся (меньше шагов)
      const largerDistanceScrollStep = scrollSpeed < EXP_SCALE_START
        ? scrollSpeed
        : scale(scrollSpeed, [EXP_SCALE_START, 100], [EXP_SCALE_START, largerDistance])

      const numSteps = Math.floor(largerDistance / largerDistanceScrollStep)
      const largerDistanceRemainder = largerDistance % largerDistanceScrollStep
      const shorterDistanceScrollStep = Math.floor(shorterDistance / numSteps)
      const shorterDistanceRemainder = shorterDistance % numSteps

      for (let i = 0; i < numSteps; i++) {
        let longerDistanceDelta = largerDistanceScrollStep
        let shorterDistanceDelta = shorterDistanceScrollStep
        if (i === numSteps - 1) {
          longerDistanceDelta += largerDistanceRemainder
          shorterDistanceDelta += shorterDistanceRemainder
        }
        let [deltaX, deltaY] = largerDistanceDir === 'x'
          ? [longerDistanceDelta, shorterDistanceDelta]
          : [shorterDistanceDelta, longerDistanceDelta]
        deltaX = deltaX * xDirection
        deltaY = deltaY * yDirection

        await cdpClient.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          deltaX,
          deltaY,
          x: location.x,
          y: location.y
        } satisfies Protocol.Input.DispatchMouseEventRequest)
      }

      await delay(optionsResolved.scrollDelay)
    },

    /** Прокручивает к указанной точке/краю. */
    async scrollTo (
      destination: ScrollToDestination,
      options?: ScrollOptions
    ): Promise<void> {
      const optionsResolved = {
        scrollDelay: 200,
        scrollSpeed: 100,
        ...defaultOptions?.scroll,
        ...options
      } satisfies ScrollOptions

      const {
        docHeight,
        docWidth,
        scrollPositionTop,
        scrollPositionLeft
      } = await page.evaluate(() => (
        {
          docHeight: document.body.scrollHeight,
          docWidth: document.body.scrollWidth,
          scrollPositionTop: window.scrollY,
          scrollPositionLeft: window.scrollX
        }
      ))

      const to = ((): Partial<Vector> => {
        switch (destination) {
          case 'top':
            return { y: 0 }
          case 'bottom':
            return { y: docHeight }
          case 'left':
            return { x: 0 }
          case 'right':
            return { x: docWidth }
          default:
            return destination
        }
      })()

      await this.scroll({
        y: to.y !== undefined ? to.y - scrollPositionTop : 0,
        x: to.x !== undefined ? to.x - scrollPositionLeft : 0
      }, optionsResolved)
    },
    // ======================================================================================
    // --- Получение элементов: CSS/XPath селекторы
    // ======================================================================================
    /** Получает элемент по селектору. Поддерживается XPath. */
    async getElement (
      selector: string | ElementHandle,
      options?: GetElementOptions
    ): Promise<ElementHandle<Element>> {
      const optionsResolved = {
        ...defaultOptions?.getElement,
        ...options
      } satisfies GetElementOptions

      let elem: ElementHandle<Element> | null = null
      if (typeof selector === 'string') {
        if (selector.startsWith('//') || selector.startsWith('(//')) {
          selector = `xpath/.${selector}`
          if (optionsResolved.waitForSelector !== undefined) {
            await page.waitForSelector(selector, { timeout: optionsResolved.waitForSelector })
          }
          const [handle] = await page.$$(selector)
          elem = handle.asElement() as ElementHandle<Element> | null
        } else {
          if (optionsResolved.waitForSelector !== undefined) {
            await page.waitForSelector(selector, { timeout: optionsResolved.waitForSelector })
          }
          elem = await page.$(selector)
        }
        if (elem === null) {
          throw new Error(
            `Could not find element with selector "${selector}", make sure you're waiting for the elements by specifying "waitForSelector"`
          )
        }
      } else {
        // ElementHandle
        elem = selector
      }
      return elem
    }
  }
  // ======================================================================================
  // -- Инициализация визуализации и фоновых движений
  // Подключение MouseHelper (по флагу visible) и запуск фона с randomMove.
  // ======================================================================================
  /**
    * Сделать курсор не видимым.
    * Определяется только при передаче `visible=true`.
    */
  actions.removeMouseHelper = visible
    ? installMouseHelper(page).then(
      ({ removeMouseHelper }) => removeMouseHelper)
    : undefined

  // Запустить фоновое случайное движение курсора; не делать `await` на `Promise` — сразу вернуть управление.
  if (performRandomMoves) {
    randomMove().then(
      (_) => { },
      (_) => { }
    )
  }

  return actions
}

export const createPersonaCursor = (
  page: Page,
  personaId: keyof typeof PERSONAS,
  sessionId?: string,
  D: number = 500,
  W: number = 40,
  visible: boolean = false
): GhostCursor => {
  const persona = PERSONAS[personaId]
  const rng = rngFromSession(sessionId ?? personaId)
  const opts = compileOptions(persona, rng, D, W)
  return createCursor(page, undefined, false, {
    move: opts.move,
    moveTo: { ...opts.move, ...opts.path },
    click: { ...opts.move, ...opts.click },
    scroll: opts.scroll
  }, visible)
}

// ======================================================================================
// -- Подключение персон с индивидуальными диапазонами соответствующих им параметров
// ======================================================================================
/**
  * Стандарт, Внимательный, Быстрый, Неуверенный, Скроллер, Торопливый
  */
export { PERSONAS, compileOptions, rngFromSession }
