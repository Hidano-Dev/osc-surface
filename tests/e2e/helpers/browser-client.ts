import { chromium, type Browser, type Page } from 'playwright'

export interface BrowserClientHandle {
  close(): Promise<void>
  consoleLogs(): readonly string[]
  waitForText(text: string, timeoutMs: number): Promise<void>
}

export async function openBrowserClient(url: string): Promise<BrowserClientHandle> {
  let browser: Browser | undefined
  let page: Page | undefined

  try {
    browser = await chromium.launch()
    page = await browser.newPage()

    const consoleLogBuffer: string[] = []

    page.on('console', (message) => {
      consoleLogBuffer.push(`[${message.type()}] ${message.text()}`)
    })

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
    })

    return new PlaywrightBrowserClient(browser, page, consoleLogBuffer)
  } catch (error) {
    await page?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    throw augmentPlaywrightError(error)
  }
}

class PlaywrightBrowserClient implements BrowserClientHandle {
  readonly #browser: Browser
  readonly #page: Page
  readonly #consoleLogBuffer: string[]
  #closePromise?: Promise<void>

  constructor(browser: Browser, page: Page, consoleLogBuffer: string[]) {
    this.#browser = browser
    this.#page = page
    this.#consoleLogBuffer = consoleLogBuffer
  }

  consoleLogs(): readonly string[] {
    return [...this.#consoleLogBuffer]
  }

  async waitForText(text: string, timeoutMs: number): Promise<void> {
    await this.#page.getByText(text, { exact: false }).waitFor({
      state: 'visible',
      timeout: timeoutMs,
    })
  }

  async close(): Promise<void> {
    if (this.#closePromise !== undefined) {
      return this.#closePromise
    }

    this.#closePromise = (async () => {
      if (!this.#page.isClosed()) {
        await this.#page.close().catch(() => undefined)
      }

      await this.#browser.close()
    })()

    await this.#closePromise
  }
}

function augmentPlaywrightError(error: unknown): Error {
  const installHint = 'If Chromium is not installed, run: corepack pnpm exec playwright install chromium'

  if (error instanceof Error) {
    error.message = `${error.message}\n${installHint}`
    return error
  }

  return new Error(`${String(error)}\n${installHint}`)
}
