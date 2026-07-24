import { afterEach, describe, expect, it, vi } from 'vitest'

import { DiagnosticsSnapshotSchema, MessageRecordSchema, type SurfaceConfig, type SurfaceStatus } from '@osc-surface/shared'

import { createDiagnosticsEngine } from './diagnostics-engine'

const SURFACE_CONFIG: SurfaceConfig = {
  unity: {
    host: '192.168.10.50',
    sendPort: 9000,
    receivePort: 9001,
  },
  debug: true,
  boolFallbackToInt: false,
  diagnostics: {
    ringBufferSize: 2,
    lossRateWindow: 4,
    ndjsonDir: 'logs/diagnostics',
    ndjsonMaxTotalBytes: 52_428_800,
  },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createDiagnosticsEngine', () => {
  it('records events, builds schema-valid snapshots, and publishes panel updates on the next tick', () => {
    vi.useFakeTimers()

    const receiveFn = vi.fn()
    const writes: string[] = []
    const stream = {
      on: vi.fn(),
      write: vi.fn((chunk: string) => {
        writes.push(chunk)
      }),
      end: vi.fn(),
    }
    const fs = {
      mkdirSync: vi.fn(),
      createWriteStream: vi.fn(() => stream),
    }

    let status: SurfaceStatus = {
      lastRttMs: null,
      consecutiveLosses: 0,
      lastPongSeq: null,
    }
    let nowMs = Date.parse('2026-07-24T12:34:56.000Z')

    const engine = createDiagnosticsEngine({
      config: SURFACE_CONFIG,
      getStatus: () => status,
      receiveFn,
      interfacesProvider: () => [
        {
          address: '192.168.10.20',
          netmask: '255.255.255.0',
          family: 'IPv4',
          internal: false,
        },
      ],
      fs,
      now: () => nowMs,
      logError: vi.fn(),
    })

    engine.recordOutgoing(
      '/avatar/message',
      [
        { type: 's', value: 'x'.repeat(300) },
        { type: 'b', value: new Uint8Array([1, 2, 3, 4]) },
      ],
      '192.168.10.50',
      9000,
    )

    nowMs += 10
    engine.recordOutgoing('/surface/diag/request', [], '127.0.0.1', 9100)

    nowMs += 10
    engine.recordIncoming('/sys/pong', [{ type: 'i', value: 7 }], '192.168.10.50', 9001)

    status = {
      lastRttMs: null,
      consecutiveLosses: 1,
      lastPongSeq: null,
    }
    engine.onPingCycle({ previousLost: true })

    status = {
      lastRttMs: 48,
      consecutiveLosses: 0,
      lastPongSeq: 7,
    }
    engine.onPongAccepted()

    vi.advanceTimersByTime(100)

    const snapshot = engine.snapshot()

    expect(DiagnosticsSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(snapshot.reachability).toBe('reachable')
    expect(snapshot.lastRttMs).toBe(48)
    expect(snapshot.consecutiveLosses).toBe(0)
    expect(snapshot.lossRate).toEqual({
      windowSize: 4,
      observed: 2,
      lost: 1,
      rate: 0.5,
    })
    expect(snapshot.subnet).toEqual({
      kind: 'sameSubnet',
      matchedInterface: '192.168.10.20',
    })
    expect(snapshot.recentMessages).toHaveLength(2)
    expect(snapshot.recentMessages[0]?.address).toBe('/avatar/message')
    expect(snapshot.recentMessages[1]?.address).toBe('/sys/pong')
    expect(snapshot.recentMessages[0]?.args).toEqual([
      {
        kind: 'value',
        type: 's',
        value: 'x'.repeat(256),
        truncated: true,
      },
      {
        kind: 'blob',
        byteLength: 4,
      },
    ])

    expect(writes).toHaveLength(2)
    expect(MessageRecordSchema.parse(JSON.parse(writes[0]!.trim()))).toEqual(snapshot.recentMessages[0])
    expect(MessageRecordSchema.parse(JSON.parse(writes[1]!.trim()))).toEqual(snapshot.recentMessages[1])

    expect(receiveFn).toHaveBeenCalledTimes(6)
    expect(String(receiveFn.mock.calls[5]?.[1] ?? '')).toContain('/avatar/message')
    expect(writes.join('')).not.toContain('/surface/diag/request')

    engine.dispose()
    expect(stream.end).toHaveBeenCalledTimes(1)
  })

  it('swallows snapshot errors and returns a schema-valid fallback snapshot', () => {
    const logError = vi.fn()
    const engine = createDiagnosticsEngine({
      config: SURFACE_CONFIG,
      getStatus: () => {
        throw new Error('status failure')
      },
      receiveFn: vi.fn(),
      interfacesProvider: () => {
        throw new Error('interface failure')
      },
      fs: {
        mkdirSync: vi.fn(),
        createWriteStream: vi.fn(() => ({
          on: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        })),
      },
      now: () => Date.parse('2026-07-24T12:34:56.000Z'),
      logError,
    })

    expect(() => engine.recordIncoming('/sys/pong', [{ type: 'i', value: 1 }], '127.0.0.1', 9000)).not.toThrow()

    const snapshot = engine.snapshot()
    expect(DiagnosticsSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(snapshot.reachability).toBe('unknown')
    expect(snapshot.subnet.kind).toBe('indeterminate')
    expect(logError).toHaveBeenCalled()
  })
})
