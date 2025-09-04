/**
 * Демонстрационный скрипт для запуска «живого» курсора в Puppeteer.
 * Что делает: открывает браузер, загружает тестовую HTML‑страницу и
 * «по‑человечески» кликает по элементам, двигая курсор плавно.
 * Запуск: npm run debug
 */

// =============================
// Импорты
// =============================
import { type ClickOptions, createCursor } from '../spoof'
import { join } from 'path'
import { promises as fs } from 'fs'
import puppeteer from 'puppeteer'

// =============================
// Утилиты
// =============================
// Простой helper для асинхронной задержки
const delay = async (ms: number): Promise<void> => {
  if (ms < 1) return
  return await new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================
// Настройки курсора (по умолчанию)
// =============================
// Базовые настройки по умолчанию для действий курсора
const cursorDefaultOptions = {
  moveDelay: 100,
  moveSpeed: 99,
  hesitate: 100,
  waitForClick: 10,
  scrollDelay: 100,
  scrollSpeed: 40,
  inViewportMargin: 50,
  waitForSelector: 200
} as const satisfies ClickOptions

// =============================
// Основной сценарий: запуск Puppeteer
// =============================
// 1) Запускаем браузер с UI (headless: false), чтобы видеть движение
puppeteer.launch({ headless: false }).then(async (browser) => {
  const page = await browser.newPage()

  // 2) Создаём курсор: последним аргументом включаем «видимый» оверлей
  const cursor = createCursor(page, undefined, undefined, {
    move: cursorDefaultOptions,
    moveTo: cursorDefaultOptions,
    click: cursorDefaultOptions,
    scroll: cursorDefaultOptions,
    getElement: cursorDefaultOptions
  }, true)

  // =============================
  // Загрузка тестовой страницы
  // =============================
  // 3) Читаем тестовую HTML‑страницу с диска
  const html = await fs.readFile(join(__dirname, 'custom-page.html'), 'utf8')

  // 4) Загружаем страницу через data: URL и ждём, пока утихнет сеть
  await page.goto('data:text/html,' + encodeURIComponent(html), {
    waitUntil: 'networkidle2'
  })

  // =============================
  // Сценарий действий курсора
  // =============================
  // 5) Небольшой сценарий кликов — курсор сам подведёт себя к блокам
  const performActions = async (): Promise<void> => {
    await cursor.click('#box1')

    await cursor.click('#box2', { moveDelay: 2000 })

    await cursor.click('#box3')

    // await cursor.click('#box1')

    // await cursor.scrollTo('right')

    // await cursor.scrollTo('left')

    // await cursor.scrollTo('bottom')

    // await cursor.scrollTo('top')
  }

  // =============================
  // Первый прогон сценария
  // =============================
  // Первый проигрыш сценария
  await performActions()

  // =============================
  // Переигрывание после перезагрузки
  // =============================
  // Позволяет нажать «обновить страницу», чтобы переиграть сценарий заново
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  page.on('load', async () => {
    await delay(500)
    await page.evaluate(() => { window.scrollTo(0, 0) })
    await delay(1000)

    await performActions()
  })
// =============================
// Обработка ошибок
// =============================
}).catch((e) => {
  console.error(e)
})
