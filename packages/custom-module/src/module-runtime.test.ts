import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import path from 'node:path'

import { SURFACE, SurfaceStatusSchema, SYS, type SurfaceConfig } from '@osc-surface/shared'

import { createCustomModuleRuntime } from './module-runtime'

const SURFACE_CONFIG: SurfaceConfig = {
  unity: {
    host: '127.0.0.1',
    sendPort: 9000,
    receivePort: 9001,
  },
  debug: false,
  boolFallbackToInt: false,
  diagnostics: {
    ringBufferSize: 200,
    lossRateWindow: 30,
    ndjsonDir: 'logs/diagnostics',
    ndjsonMaxTotalBytes: 52_428_800,
  },
}

const LAYOUT_JSON = {
  content: {
    widgets: [
      {
        id: 'smile_blend',
        type: 'fader',
        address: '/avatar/blend/smile',
      },
      {
        id: 'dynamic',
        type: 'panel',
        widgets: [],
      },
    ],
  },
}

const VALID_MANIFEST_JSON = JSON.stringify({
  version: 1,
  entries: [
    {
      address: '/avatar/blend/smile',
      type: 'f',
      widget: 'fader',
      label: 'Smile',
      range: [0, 1],
      default: 0.75,
    },
  ],
})

describe('createCustomModuleRuntime', () => {
  it('requests the manifest on init, then starts a 2 second loop for ping and manifest retries', () => {
    const sendFn = vi.fn()
    const setIntervalFn = vi.fn<(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>>()
    let tick: (() => void) | null = null

    setIntervalFn.mockImplementation((callback, intervalMs) => {
      expect(intervalMs).toBe(2000)
      tick = callback

      return 1 as unknown as ReturnType<typeof setInterval>
    })

    const runtime = createCustomModuleRuntime({
      loadLayout: () => LAYOUT_JSON,
      loadConfig: () => SURFACE_CONFIG,
      now: vi
        .fn()
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(2100)
        .mockReturnValueOnce(2101)
        .mockReturnValueOnce(4100)
        .mockReturnValueOnce(4101),
      sendFn,
      setIntervalFn,
    })

    runtime.init()

    expect(sendFn).toHaveBeenNthCalledWith(1, '127.0.0.1', 9000, SYS.MANIFEST_REQUEST)
    expect(tick).not.toBeNull()

    if (tick) {
      tick()
    }

    expect(sendFn).toHaveBeenNthCalledWith(2, '127.0.0.1', 9000, SYS.PING, { type: 'i', value: 1 })
    expect(sendFn).toHaveBeenNthCalledWith(3, '127.0.0.1', 9000, SYS.MANIFEST_REQUEST)

    if (tick) {
      tick()
    }

    expect(sendFn).toHaveBeenNthCalledWith(4, '127.0.0.1', 9000, SYS.PING, { type: 'i', value: 2 })
    expect(sendFn).toHaveBeenNthCalledWith(5, '127.0.0.1', 9000, SYS.MANIFEST_REQUEST)
  })

  it('swallows pong messages and updates the status snapshot only for matching integer seq values', () => {
    const sendFn = vi.fn()
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(101).mockReturnValueOnce(145).mockReturnValueOnce(200)
    let tick: (() => void) | null = null

    const runtime = createCustomModuleRuntime({
      loadLayout: () => LAYOUT_JSON,
      loadConfig: () => SURFACE_CONFIG,
      now,
      sendFn,
      setIntervalFn: (callback) => {
        tick = callback
        return 1 as unknown as ReturnType<typeof setInterval>
      },
    })

    runtime.init()
    if (tick) {
      tick()
    }

    expect(
      runtime.oscInFilter({
        address: SYS.PONG,
        args: [{ type: 'i', value: 1 }],
        host: '127.0.0.1',
        port: 9000,
      }),
    ).toBe(false)

    expect(
      runtime.oscInFilter({
        address: SURFACE.STATUS_REQUEST,
        args: [],
        host: '127.0.0.1',
        port: 9100,
      }),
    ).toBe(false)

    const statusArg = sendFn.mock.calls[2]?.[3]
    expect(sendFn.mock.calls[2]?.slice(0, 3)).toEqual(['127.0.0.1', 9100, SURFACE.STATUS])
    expect(statusArg).toEqual({
      type: 's',
      value: JSON.stringify({
        lastRttMs: 99,
        consecutiveLosses: 0,
        lastPongSeq: 1,
      }),
    })
    expect(SurfaceStatusSchema.parse(JSON.parse(statusArg.value))).toEqual({
      lastRttMs: 99,
      consecutiveLosses: 0,
      lastPongSeq: 1,
    })

    expect(
      runtime.oscInFilter({
        address: SYS.PONG,
        args: [{ type: 's', value: '1' }],
        host: '127.0.0.1',
        port: 9000,
      }),
    ).toBe(false)
  })

  it('swallows other internal addresses and passes through non-internal messages', () => {
    const runtime = createCustomModuleRuntime({
      loadLayout: () => LAYOUT_JSON,
      loadConfig: () => SURFACE_CONFIG,
      sendFn: vi.fn(),
    })

    expect(
      runtime.oscInFilter({
        address: SYS.STATS,
        args: [{ type: 's', value: '{}' }],
        host: '127.0.0.1',
        port: 9000,
      }),
    ).toBe(false)

    const externalMessage = {
      address: '/avatar/position',
      args: [{ type: 'f', value: 1.25 }],
      host: '127.0.0.1',
      port: 9000,
    } satisfies OscMessage

    expect(runtime.oscInFilter(externalMessage)).toBe(externalMessage)
    expect(runtime.oscOutFilter(externalMessage)).toBe(externalMessage)
  })

  it('applies an accepted manifest to the runtime and swallows /sys/manifest', () => {
    const receiveFn = vi.fn()
    const runtime = createCustomModuleRuntime({
      loadLayout: () => LAYOUT_JSON,
      loadConfig: () => SURFACE_CONFIG,
      now: vi.fn().mockReturnValue(100),
      receiveFn,
      sendFn: vi.fn(),
    })

    runtime.init()

    expect(
      runtime.oscInFilter({
        address: SYS.MANIFEST,
        args: [{ type: 's', value: VALID_MANIFEST_JSON }],
        host: '127.0.0.1',
        port: 9000,
      }),
    ).toBe(false)

    expect(receiveFn).toHaveBeenNthCalledWith(
      1,
      '/EDIT',
      'smile_blend',
      JSON.stringify({
        label: 'Smile',
        range: {
          min: 0,
          max: 1,
        },
      }),
      JSON.stringify({ noWarning: true }),
    )
    expect(receiveFn).toHaveBeenNthCalledWith(
      2,
      '/EDIT',
      'dynamic',
      JSON.stringify({
        widgets: [],
      }),
      JSON.stringify({ noWarning: true }),
    )
    expect(receiveFn).toHaveBeenNthCalledWith(3, '/avatar/blend/smile', 0.75)
  })

  it('re-applies the accepted manifest only to the newly opened client session', () => {
    const receiveFn = vi.fn()
    const appEvents = new EventEmitter()
    const runtime = createCustomModuleRuntime({
      appEvents,
      loadLayout: () => LAYOUT_JSON,
      loadConfig: () => SURFACE_CONFIG,
      now: vi.fn().mockReturnValue(100),
      receiveFn,
      sendFn: vi.fn(),
    })

    runtime.init()
    receiveFn.mockClear()

    runtime.oscInFilter({
      address: SYS.MANIFEST,
      args: [{ type: 's', value: VALID_MANIFEST_JSON }],
      host: '127.0.0.1',
      port: 9000,
    })
    receiveFn.mockClear()

    appEvents.emit('sessionOpened', {}, { id: 'client-1' })

    expect(receiveFn).toHaveBeenNthCalledWith(
      1,
      '/EDIT',
      'smile_blend',
      JSON.stringify({
        label: 'Smile',
        range: {
          min: 0,
          max: 1,
        },
      }),
      JSON.stringify({ noWarning: true }),
      { clientId: 'client-1' },
    )
    expect(receiveFn).toHaveBeenNthCalledWith(
      2,
      '/EDIT',
      'dynamic',
      JSON.stringify({
        widgets: [],
      }),
      JSON.stringify({ noWarning: true }),
      { clientId: 'client-1' },
    )
    expect(receiveFn).toHaveBeenNthCalledWith(3, '/avatar/blend/smile', 0.75, { clientId: 'client-1' })
  })

  it('logs non-repeated manifest validation failures and keeps retrying while requesting', () => {
    const sendFn = vi.fn()
    const logError = vi.fn()
    const now = vi
      .fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(101)
      .mockReturnValueOnce(2100)
      .mockReturnValueOnce(2101)
      .mockReturnValueOnce(2200)
      .mockReturnValueOnce(2201)
      .mockReturnValueOnce(2202)
    let tick: (() => void) | null = null

    const runtime = createCustomModuleRuntime({
      loadLayout: () => LAYOUT_JSON,
      loadConfig: () => SURFACE_CONFIG,
      logError,
      now,
      sendFn,
      setIntervalFn: (callback) => {
        tick = callback
        return 1 as unknown as ReturnType<typeof setInterval>
      },
    })

    runtime.init()

    const invalidManifestMessage = {
      address: SYS.MANIFEST,
      args: [{ type: 's', value: '{"version":1,"entries":"invalid"}' }],
      host: '127.0.0.1',
      port: 9000,
    } satisfies OscMessage

    expect(runtime.oscInFilter(invalidManifestMessage)).toBe(false)
    expect(runtime.oscInFilter(invalidManifestMessage)).toBe(false)
    expect(logError).toHaveBeenCalledTimes(1)

    sendFn.mockClear()

    if (tick) {
      tick()
      tick()
    }

    expect(
      runtime.oscInFilter({
        address: SYS.PONG,
        args: [{ type: 'i', value: 2 }],
        host: '127.0.0.1',
        port: 9000,
      }),
    ).toBe(false)

    expect(sendFn.mock.calls).toEqual([
      ['127.0.0.1', 9000, SYS.PING, { type: 'i', value: 1 }],
      ['127.0.0.1', 9000, SYS.MANIFEST_REQUEST],
      ['127.0.0.1', 9000, SYS.PING, { type: 'i', value: 2 }],
      ['127.0.0.1', 9000, SYS.MANIFEST_REQUEST],
    ])
  })

  it('clears the ping timer on stop and unload', () => {
    const clearIntervalFn = vi.fn()

    const runtime = createCustomModuleRuntime({
      clearIntervalFn,
      loadLayout: () => LAYOUT_JSON,
      loadConfig: () => SURFACE_CONFIG,
      sendFn: vi.fn(),
      setIntervalFn: () => 99 as unknown as ReturnType<typeof setInterval>,
    })

    runtime.init()
    runtime.stop()
    runtime.unload()

    expect(clearIntervalFn).toHaveBeenCalledTimes(1)
    expect(clearIntervalFn).toHaveBeenCalledWith(99)
  })

  it('resolves relative layout paths against the workspace before loading layout JSON', () => {
    const loadJson = vi.fn().mockReturnValue(LAYOUT_JSON)
    const globalWithLoadJson = globalThis as typeof globalThis & {
      loadJSON?: (filePath: string) => unknown
    }
    const previousLoadJson = globalWithLoadJson.loadJSON

    globalWithLoadJson.loadJSON = loadJson

    try {
      const runtime = createCustomModuleRuntime({
        loadConfig: () => SURFACE_CONFIG,
        sendFn: vi.fn(),
        settingsRead: (name) => {
          expect(name).toBe('load')
          return 'layouts/main.json'
        },
      })

      runtime.init()

      expect(loadJson).toHaveBeenCalledWith(path.resolve(process.cwd(), 'layouts/main.json'))
    } finally {
      globalWithLoadJson.loadJSON = previousLoadJson
    }
  })
})
