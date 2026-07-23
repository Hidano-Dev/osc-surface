import { describe, expect, it, vi } from 'vitest'

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
}

describe('createCustomModuleRuntime', () => {
  it('starts a 2 second ping loop and sends seq integers to the configured Unity target', () => {
    const sendFn = vi.fn()
    const setIntervalFn = vi.fn<(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>>()
    let tick: (() => void) | null = null

    setIntervalFn.mockImplementation((callback, intervalMs) => {
      expect(intervalMs).toBe(2000)
      tick = callback

      return 1 as unknown as ReturnType<typeof setInterval>
    })

    const runtime = createCustomModuleRuntime({
      loadConfig: () => SURFACE_CONFIG,
      now: vi.fn().mockReturnValue(100),
      sendFn,
      setIntervalFn,
    })

    runtime.init()

    expect(sendFn).not.toHaveBeenCalled()
    expect(tick).not.toBeNull()

    if (tick) {
      tick()
    }

    expect(sendFn).toHaveBeenCalledWith('127.0.0.1', 9000, SYS.PING, { type: 'i', value: 1 })
  })

  it('swallows pong messages and updates the status snapshot only for matching integer seq values', () => {
    const sendFn = vi.fn()
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(145).mockReturnValueOnce(200)
    let tick: (() => void) | null = null

    const runtime = createCustomModuleRuntime({
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

    const statusArg = sendFn.mock.calls[1]?.[3]
    expect(sendFn.mock.calls[1]?.slice(0, 3)).toEqual(['127.0.0.1', 9100, SURFACE.STATUS])
    expect(statusArg).toEqual({
      type: 's',
      value: JSON.stringify({
        lastRttMs: 45,
        consecutiveLosses: 0,
        lastPongSeq: 1,
      }),
    })
    expect(SurfaceStatusSchema.parse(JSON.parse(statusArg.value))).toEqual({
      lastRttMs: 45,
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

  it('clears the ping timer on stop and unload', () => {
    const clearIntervalFn = vi.fn()

    const runtime = createCustomModuleRuntime({
      clearIntervalFn,
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
})
