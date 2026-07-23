import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { openBrowserClient } from './helpers/browser-client'
import { ProcessHarness } from './helpers/process'
import { createWidgetInspector } from './helpers/widget-inspector'

describe('WidgetInspector', () => {
  const harness = new ProcessHarness()

  afterEach(async () => {
    await harness.stopAll()
  })

  afterAll(async () => {
    await harness.stopAll()
  })

  test('reads props, waits for props, and round-trips values against O-S-C headless', async () => {
    await harness.start({
      command: process.execPath,
      args: [
        'vendor/open-stage-control/app',
        '-n',
        '-p',
        '7080',
        '-o',
        '9001',
        '-l',
        'layouts/main.json',
      ],
      readyPattern: /Server started, app available at/,
      readyTimeoutMs: 30_000,
    })

    const browser = await openBrowserClient('http://127.0.0.1:7080')
    const inspector = await createWidgetInspector({ host: '127.0.0.1', port: 9001 })

    try {
      const props = await inspector.getProps('smile_blend')

      expect(props).toMatchObject({
        id: 'smile_blend',
        type: 'fader',
        address: '/avatar/blend/smile',
      })
      expect(props.range).toEqual({ min: 0, max: 1 })

      const waitedProps = await inspector.waitForProps(
        'smile_blend',
        (candidate) => candidate.type === 'fader' && candidate.address === '/avatar/blend/smile',
        2_000,
      )

      expect(waitedProps.id).toBe('smile_blend')

      await inspector.set('smile_blend', 0.25)

      await expect
        .poll(async () => inspector.getValue('smile_blend'), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([{ type: 'f', value: 0.25 }])

      expect(browser.consoleLogs().filter((entry) => entry.startsWith('[error]'))).toEqual([])
    } finally {
      await inspector.close()
      await browser.close()
    }
  })
})
