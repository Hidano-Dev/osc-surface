import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticsSnapshot } from '@osc-surface/shared'
import { SURFACE_DIAG } from '@osc-surface/shared'

import { createDiagPanelSink } from './diag-panel-sink'

const SNAPSHOT: DiagnosticsSnapshot = {
  reachability: 'reachable',
  lastRttMs: 42,
  consecutiveLosses: 0,
  lossRate: {
    windowSize: 30,
    observed: 10,
    lost: 1,
    rate: 0.1,
  },
  subnet: {
    kind: 'sameSubnet',
    matchedInterface: 'Ethernet 1',
  },
  logUsage: {
    totalBytes: 5 * 1024 * 1024,
    limitBytes: 10 * 1024 * 1024,
    overLimit: false,
  },
  recentMessages: [
    {
      ts: '2026-07-24T12:34:56.000Z',
      dir: 'in',
      address: '/sys/pong',
      args: [],
      peer: {
        host: '127.0.0.1',
        port: 9000,
      },
    },
    {
      ts: '2026-07-24T12:34:55.000Z',
      dir: 'out',
      address: '/avatar/smile',
      args: [
        {
          kind: 'value',
          type: 'f',
          value: 0.5,
        },
        {
          kind: 'blob',
          byteLength: 16,
        },
      ],
    },
  ],
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createDiagPanelSink', () => {
  it('emits one receive burst on the next 100ms tick after becoming dirty', () => {
    vi.useFakeTimers()

    const receiveFn = vi.fn()
    const sink = createDiagPanelSink({
      getSnapshot: () => SNAPSHOT,
      receiveFn,
    })

    sink.markDirty()
    sink.markDirty()

    vi.advanceTimersByTime(99)
    expect(receiveFn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(receiveFn.mock.calls).toEqual([
      [SURFACE_DIAG.REACHABILITY, '到達'],
      [SURFACE_DIAG.RTT, '42'],
      [SURFACE_DIAG.LOSS_RATE, '10% (1/10)'],
      [SURFACE_DIAG.SUBNET, '同一サブネット (Ethernet 1)'],
      [SURFACE_DIAG.LOG_USAGE, '5.0/10.0 MB'],
      [
        SURFACE_DIAG.MESSAGES,
        '2026-07-24T12:34:56.000Z [in] /sys/pong [] @ 127.0.0.1:9000\n2026-07-24T12:34:55.000Z [out] /avatar/smile [f:0.5, blob:16]',
      ],
    ])

    receiveFn.mockClear()
    vi.advanceTimersByTime(100)
    expect(receiveFn).not.toHaveBeenCalled()

    sink.dispose()
  })

  it('batches later dirty marks into the next tick only once', () => {
    vi.useFakeTimers()

    const receiveFn = vi.fn()
    const sink = createDiagPanelSink({
      getSnapshot: () => SNAPSHOT,
      receiveFn,
    })

    sink.markDirty()
    vi.advanceTimersByTime(100)
    expect(receiveFn).toHaveBeenCalledTimes(6)

    receiveFn.mockClear()
    sink.markDirty()
    sink.markDirty()
    vi.advanceTimersByTime(100)

    expect(receiveFn).toHaveBeenCalledTimes(6)
    expect(receiveFn.mock.calls[0]).toEqual([SURFACE_DIAG.REACHABILITY, '到達'])

    sink.dispose()
  })

  it('stops emitting after disposal', () => {
    vi.useFakeTimers()

    const receiveFn = vi.fn()
    const clearIntervalFn = vi.fn(clearInterval)
    const sink = createDiagPanelSink({
      getSnapshot: () => ({
        ...SNAPSHOT,
        reachability: 'lost',
        lastRttMs: null,
        lossRate: {
          windowSize: 30,
          observed: 0,
          lost: 0,
          rate: null,
        },
        subnet: {
          kind: 'indeterminate',
          reason: 'hostname',
        },
        logUsage: {
          totalBytes: 12 * 1024 * 1024,
          limitBytes: 10 * 1024 * 1024,
          overLimit: true,
        },
        recentMessages: [],
      }),
      receiveFn,
      clearIntervalFn,
    })

    sink.markDirty()
    sink.dispose()

    vi.advanceTimersByTime(100)
    expect(receiveFn).not.toHaveBeenCalled()
    expect(clearIntervalFn).toHaveBeenCalledTimes(1)

    sink.markDirty()
    vi.advanceTimersByTime(100)
    expect(receiveFn).not.toHaveBeenCalled()
  })
})

