# Ghost Cursor

<img src="https://media2.giphy.com/media/26ufp2LYURTvL5PRS/giphy.gif" width="100" align="right">

Генерируйте реалистичные, человекоподобные траектории движения мыши между координатами или перемещайтесь между элементами с помощью Puppeteer — как будто вы точно не робот.

> Ага? А робот смог бы **вот так?**

## Установка

```sh
yarn add ghost-cursor
```
or with npm
```sh
npm install ghost-cursor
```

## Использование
Генерация данных движения между двумя координатами.

```js
import { path } from "ghost-cursor"

const from = { x: 100, y: 100 }
const to = { x: 600, y: 700 }

const route = path(from, to)

/**
 * [
 *   { x: 100, y: 100 },
 *   { x: 108.75573501957051, y: 102.83608396351725 },
 *   { x: 117.54686481838543, y: 106.20019239793275 },
 *   { x: 126.3749821408895, y: 110.08364505509256 },
 *   { x: 135.24167973152743, y: 114.47776168684264 }
 *   ... and so on
 * ]
 */
```

Генерация данных движения между двумя координатами с метками времени.
```js
import { path } from "ghost-cursor"

const from = { x: 100, y: 100 }
const to = { x: 600, y: 700 }

const route = path(from, to, { useTimestamps: true })

/**
 * [
 *   { x: 100, y: 100, timestamp: 1711850430643 },
 *   { x: 114.78071695023473, y: 97.52340709495319, timestamp: 1711850430697 },
 *   { x: 129.1362373468682, y: 96.60141853603243, timestamp: 1711850430749 },
 *   { x: 143.09468422606352, y: 97.18676354029148, timestamp: 1711850430799 },
 *   { x: 156.68418062398405, y: 99.23217132478408, timestamp: 1711850430848 },
 *   ... and so on
 * ]
 */
```

Использование с Puppeteer:
```js
import { createCursor } from "ghost-cursor"
import puppeteer from "puppeteer"

const run = async (url) => {
  const selector = "#sign-up button"
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage()
  const cursor = createCursor(page)
  await page.goto(url)
  await page.waitForSelector(selector)
  await cursor.click(selector)
  // shorthand for
  // await cursor.move(selector)
  // await cursor.click()
}
```

### Поведение, специфичное для Puppeteer

  * `cursor.move()` автоматически будет немного «перелетать» цель или слегка промахиваться и корректировать позицию заново для элементов, которые находятся слишком далеко от начальной точки курсора.
  * При наведении на объекты выбирается случайная координата **внутри** элемента, а не точный центр.
  * Скорость движения мыши учитывает расстояние до цели и размер элемента, по которому вы кликаете.

## Методы

#### Создаёт «Ghost Cursor». Возвращает функции действий курсора, описанные ниже.

`createCursor(page: puppeteer.Page, start?: Vector, performRandomMoves?: boolean, defaultOptions?: DefaultOptions, visible?: boolean = false): GhostCursor`

  * **page:** Экземпляр Puppeteer `page`.
  * **start (необязательно):** Начальная позиция курсора. По умолчанию `{ x: 0, y: 0 }`.
  * **performRandomMoves (необязательно):** Сразу выполнять случайные движения. По умолчанию `false`.
  * **defaultOptions (необязательно):** Пользовательские значения по умолчанию для функций `click`, `move`, `moveTo` и `randomMove`. Значения по умолчанию описаны ниже.
  * **visible (необязательно):** Сделать курсор видимым с помощью `installMouseHelper()`. По умолчанию `false`.

#### Включает или отключает случайные движения мыши.

`toggleRandomMove(random: boolean): void`

#### Симулирует клик мышью по указанному селектору или элементу.

`click(selector?: string | ElementHandle, options?: ClickOptions): Promise<void>`

  * **selector (необязательно):** CSS‑селектор или `ElementHandle` целевого элемента.
  * **options (необязательно):** Дополнительные параметры клика. Расширяет параметры `move` (см. ниже).

    * `hesitate (number):` Пауза перед началом клика в миллисекундах. По умолчанию `0`.
    * `waitForClick (number):` Пауза между `mousedown` и `mouseup` в миллисекундах. По умолчанию `0`.
    * `moveDelay (number):` Задержка после перемещения мыши в миллисекундах. По умолчанию `2000`. Если `randomizeMoveDelay=true`, задержка рандомизируется от 0 до `moveDelay`.
    * `button (MouseButton):` Кнопка мыши. По умолчанию `left`.
    * `clickCount (number):` Количество кликов. По умолчанию `1`.

#### Перемещает мышь к указанному селектору или элементу.

`move(selector: string | ElementHandle, options?: MoveOptions): Promise<void>`

  * **selector:** CSS‑селектор или `ElementHandle` целевого элемента.
  * **options (необязательно):** Дополнительные параметры перемещения. Расширяет параметры `scrollIntoView` и `moveTo` (см. ниже).

    * `paddingPercentage (number):` Процент внутреннего «поля» внутри элемента при выборе точки назначения. По умолчанию `0` (может переместиться в любую точку элемента). Значение `100` всегда ведёт к центру элемента.
    * `destination (Vector):` Точка назначения относительно левого верхнего угла элемента. Если указано, `paddingPercentage` не используется. Если не указано (по умолчанию) — выбирается случайная точка с учётом `paddingPercentage`.
    * `moveDelay (number):` Задержка после перемещения в мс. По умолчанию `0`. При `randomizeMoveDelay=true` — случайная от `0` до `moveDelay`.
    * `randomizeMoveDelay (boolean):` Рандомизация задержки между действиями от `0` до `moveDelay`. По умолчанию `true`.
    * `maxTries (number):` Максимум попыток навести курсор на элемент. По умолчанию `10`.
    * `moveSpeed (number):` Скорость перемещения мыши. По умолчанию — случайная.
    * `overshootThreshold (number):` Дистанция до точки назначения, при превышении которой включается «перелёт» (overshoot). Ниже порога «перелёта» не будет. По умолчанию `500`.

#### Перемещает мышь к указанной точке назначения.
`moveTo(destination: Vector, options?: MoveToOptions): Promise<void>`

  * **destination:** Объект с координатами `x` и `y`, например `{ x: 500, y: 300 }`.
  * **options (необязательно):** Дополнительные параметры перемещения.

    * `moveSpeed (number):` Скорость перемещения. По умолчанию — случайная.
    * `moveDelay (number):` Задержка после перемещения, мс. По умолчанию `0`. При `randomizeMoveDelay=true` — случайная от `0` до `moveDelay`.
    * `randomizeMoveDelay (boolean):` Рандомизация задержки между действиями. По умолчанию `true`.

#### Сдвигает мышь на заданное смещение.

`moveBy(delta: Vector, options?: MoveToOptions): Promise<void>`

* **delta:** Объект с `x` и `y`, например `{ x: 10, y: 20 }`.
* **options (необязательно):** Те же параметры, что и у `moveTo`.
  
#### Прокручивает страницу так, чтобы элемент оказался в области видимости. Если уже виден, прокрутки не будет.

`scrollIntoView(selector: string | ElementHandle, options?: ScrollIntoViewOptions) => Promise<void>`

  * **selector:** CSS‑селектор или `ElementHandle` элемента.
  * **options (необязательно):** Дополнительные параметры. Расширяет параметры `scroll` и `getElement` (см. ниже).

    * `scrollSpeed (number):` Скорость прокрутки от 0 до 100. `100` — мгновенно. По умолчанию `100`.
    * `scrollDelay (number):` Пауза после прокрутки (если прокрутка была). По умолчанию `200`.
    * `inViewportMargin (number):` Отступ (в пикселях), добавляемый вокруг элемента при обеспечении его видимости. По умолчанию `0`.

#### Прокручивает к указанной точке назначения.

`scrollTo: (destination: Partial<Vector> | 'top' | 'bottom' | 'left' | 'right', options?: ScrollOptions) => Promise<void>`

  * **destination:** Объект с координатами `x` и `y`, например `{ x: 500, y: 300 }`. Также можно использовать строки: `top`, `bottom`, `left`, `right`.
  * **options (необязательно):** Дополнительные параметры прокрутки. Использует параметры `scroll` (см. ниже).

#### Прокручивает страницу на расстояние, заданное `delta`.

`scroll: (delta: Partial<Vector>, options?: ScrollOptions) => Promise<void>`

  * **delta:** Объект с `x` и/или `y` — смещение от текущей позиции.
  * **options (необязательно):** Дополнительные параметры.

    * `scrollSpeed (number):` Скорость прокрутки 0–100. `100` — мгновенно. По умолчанию `100`.
    * `scrollDelay (number):` Пауза после прокрутки. По умолчанию `200`.

#### Нажатие/отжатие кнопки мыши.

`mouseDown / mouseUp: (options?: MouseButtonOptions) => Promise<void>`

  * **options (необязательно):** Параметры действия.

    * `button (MouseButton):` Кнопка мыши. По умолчанию `left`.
    * `clickCount (number):` Количество «кликов». По умолчанию `1`.
  
#### Получает элемент по селектору. Можно использовать XPath.

`getElement(selector: string | ElementHandle, options?: GetElementOptions) => Promise<void>`

* **selector:** CSS-селектор или `ElementHandle` целевого элемента.
* **options (необязательно):** Дополнительные параметры.

  * `waitForSelector (number):` Время ожидания появления селектора в мс. По умолчанию ожидания нет.

#### Возвращает текущую позицию курсора.

`getLocation(): Vector`

### Прочие утилиты

#### Устанавливает визуальный помощник курсора на страницу, делая указатель видимым. 
Вызывается автоматически в инициализации `GhostCursor`, если передать `visible=true`. Используйте только для отладки.

`installMouseHelper(page: Page): Promise<void>`

#### Возвращает случайную точку на окне браузера.

`getRandomPagePoint(page: Page): Promise<Vector>`

#### Генерирует набор точек для движения курсора между двумя координатами.

`path(start: Vector, end: Vector | BoundingBox, options?: number | PathOptions): Vector[] | TimedVector[]`

* **start:** Начальная точка.
* **end:** Конечная точка (или `BoundingBox`).
* **options (необязательно):** Дополнительные параметры генерации пути. Может быть числом — тогда устанавливается `spreadOverride`.

  * `spreadOverride (number):` Переопределяет «разлёт» сгенерированной траектории.
  * `moveSpeed (number):` Скорость движения. По умолчанию — случайная.
  * `useTimestamps (boolean):` Генерировать метки времени для каждой точки на основе правила трапеций.

## Как это работает

Кривые Безье делают почти всю работу. Они позволяют создавать бесконечное количество кривых между любыми двумя точками — и выглядят довольно «по‑человечески» (по крайней мере, более естественно, чем альтернативы вроде шума Перлина или симплекс‑шума).

![](https://mamamoo.xetera.dev/😽🤵👲🧦👵.png)

Магия в том, что можно задать несколько контрольных точек, через которые пойдёт кривая. Для этого случайным образом выбираются 2 координаты в ограниченной области над и под прямой между началом и концом.

<img src="https://mamamoo.xetera.dev/🧣👎😠🧟✍.png" width="400">

Однако нам не нужны странные «ломаные» кубические кривые — так мышью никто не двигает. Поэтому при генерации случайных точек выбирается только **одна** сторона линии.

<img src="http://simonwallner.at/ext/fitts/shannon.png" width="250" align="right">
При расчёте скорости движения мыши мы используем <a href="https://en.wikipedia.org/wiki/Fitts%27s_law">Fitts's закон</a>
чтобы определить количество точек, которые следует возвращать в зависимости от ширины элемента, по которому производится клик, и расстояния между мышью и этим объектом.


## Включение логирования

Установите переменную окружения `DEBUG` следующим образом:

- OSX: `DEBUG="ghost-cursor:*"`
- Linux: `DEBUG="ghost-cursor:*"`
- Windows CMD: `set DEBUG=ghost-cursor:*`
- Windows PowerShell: `$env:DEBUG = "ghost-cursor:*"`

### Методы
- Включает или отключает случайные движения мыши.
  `toggleRandomMove`
- Симулирует клик мышью по указанному селектору или элементу.
  `click(selector)`
- Перемещает мышь к указанному селектору или элементу.
  `move(selector)`
- Перемещает мышь к указанной точке назначения.
  `moveTo(destination`
- Сдвигает мышь на заданное смещение.
  `moveBy(delta)`
- Прокручивает страницу так, чтобы элемент оказался в области видимости (если уже виден, прокрутки не будет).
  `scrollIntoView(selector)`
- Прокручивает к указанной точке назначения.
  `scrollTo: (destination)`
- Прокручивает страницу на заданное расстояние.
  `scroll: (delta)`
- Нажатие/отжатие кнопки мыши.
  `mouseDown/mouseUp: (options)`
- Получает элемент по селектору (можно использовать XPath).
  `getElement(selector)`
- Возвращает текущую позицию курсора.
  `getLocation(): Vector`
- Возвращает случайную точку на окне браузера.
  `getRandomPagePoint(page: Page): Promise<Vector>`
- Генерирует набор точек для движения курсора между двумя координатами.
  `path()`