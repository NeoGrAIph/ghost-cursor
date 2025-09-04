/**
 * Демонстрационный скрипт для запуска «живого» курсора в Puppeteer.
 * Что делает: открывает браузер, загружает тестовую HTML‑страницу и
 * «по‑человечески» кликает по элементам, двигая курсор плавно.
 * Запуск: npm run debug
 */

// =============================
// Импорты
// =============================
import { createPersonaCursor, PERSONAS } from '../spoof'
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

// Выбор персоны через переменную окружения PERSONA
const personaId = process.env.PERSONA ?? 'P4'
if (!(personaId in PERSONAS)) {
  console.error(`Unknown persona "${personaId}". Available: ${Object.keys(PERSONAS).join(', ')}`)
  process.exit(1)
}

// =============================
// Основной сценарий: запуск Puppeteer
// =============================
// 1) Запускаем браузер с UI (headless: false), чтобы видеть движение
puppeteer.launch({ headless: false }).then(async (browser) => {
  const page = await browser.newPage()

  // 2) Создаём курсор выбранной персоны
  const cursor = createPersonaCursor(page, personaId, 'debug-session', 500, 40, true)

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

    await cursor.click('#box2')

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
