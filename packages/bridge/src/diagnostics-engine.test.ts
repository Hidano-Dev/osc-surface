import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

import { DiagnosticsSnapshotSchema, MessageRecordSchema, OSCDESK_DIAG, SYS, type BridgeConfig, type SurfaceStatus } from '@oscdesk/shared'

import { createDiagnosticsEngine } from './diagnostics-engine'

const SURFACE_CONFIG: BridgeConfig = {
  unity: {
    host: '192.168.10.50',
    sendPort: 9000,
  },
  bridge: { oscListenHost: '0.0.0.0', oscListenPort: 9001, wsHost: '0.0.0.0', wsPort: 7080 },
  ui: { host: '0.0.0.0', port: 8080 },
  debug: true,
  boolFallbackToInt: false,
  diagnostics: {
    ringBufferSize: 2,
    lossRateWindow: 4,
    ndjsonDir: 'logs/diagnostics',
    ndjsonMaxTotalBytes: 52_428_800,
  },
  oscUi: {
    enabled: false,
    staticPeers: [],
    peerTtlMs: 0,
  },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createDiagnosticsEngine', () => {
  it('records events and builds schema-valid snapshots without a UI delivery dependency', () => {
    vi.useFakeTimers()

    const writes: string[] = []
    const stream = {
      on: vi.fn(),
      write: vi.fn((chunk: string) => {
        writes.push(chunk)
      }),
      end: vi.fn(),
    }
    const currentFileName = 'osc-debug-2026-07-24T12-34-56-000Z.ndjson'
    const logDir = path.resolve(process.cwd(), SURFACE_CONFIG.diagnostics.ndjsonDir)
    const fs = {
      mkdirSync: vi.fn(),
      readdirSync: vi.fn(() => [currentFileName]),
      statSync: vi.fn((filePath: string) => ({
        isFile: () => filePath === path.join(logDir, currentFileName),
        size: writes.join('').length,
        mtimeMs: Date.parse('2026-07-24T12:34:56.000Z'),
      })),
      unlinkSync: vi.fn(),
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
      interfacesProvider: () => [
        {
          address: '192.168.10.20',
          netmask: '255.255.255.0',
          family: 'IPv4',
          internal: false,
        },
      ],
      fs,
      protectedFileNames: ['osc-guard-current.ndjson'],
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
    engine.recordOutgoing(OSCDESK_DIAG.REQUEST, [], '127.0.0.1', 9100)

    nowMs += 10
    engine.recordIncoming(SYS.PONG, [{ type: 'i', value: 7 }], '192.168.10.50', 9001)

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
    expect(snapshot.logUsage).toEqual({
      totalBytes: 0,
      limitBytes: 52_428_800,
      overLimit: false,
    })
    expect(snapshot.recentMessages).toHaveLength(2)
    expect(snapshot.recentMessages[0]?.address).toBe('/avatar/message')
    expect(snapshot.recentMessages[1]?.address).toBe(SYS.PONG)
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

    expect(writes.join('')).not.toContain(OSCDESK_DIAG.REQUEST)

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
      interfacesProvider: () => {
        throw new Error('interface failure')
      },
      fs: {
        mkdirSync: vi.fn(),
        readdirSync: vi.fn(() => []),
        statSync: vi.fn(() => ({
          isFile: () => true,
          size: 0,
          mtimeMs: 0,
        })),
        unlinkSync: vi.fn(),
        createWriteStream: vi.fn(() => ({
          on: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        })),
      },
      now: () => Date.parse('2026-07-24T12:34:56.000Z'),
      logError,
    })

    expect(() => engine.recordIncoming(SYS.PONG, [{ type: 'i', value: 1 }], '127.0.0.1', 9000)).not.toThrow()

    const snapshot = engine.snapshot()
    expect(DiagnosticsSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(snapshot.reachability).toBe('unknown')
    expect(snapshot.subnet.kind).toBe('indeterminate')
    expect(logError).toHaveBeenCalled()
  })

  it('automatically purges old logs and warns once when capacity polling detects overflow', () => {
    vi.useFakeTimers()

    const logWarn = vi.fn()
    const currentFileName = 'osc-debug-2026-07-24T12-34-56-000Z.ndjson'
    const olderFileName = 'osc-debug-2026-07-24T12-30-00-000Z.ndjson'
    const oldestFileName = 'osc-debug-2026-07-24T12-00-00-000Z.ndjson'
    const logDir = path.resolve(process.cwd(), 'logs/diagnostics')
    const files = new Map<string, { size: number; mtimeMs: number }>([
      [
        currentFileName,
        {
          size: 120,
          mtimeMs: Date.parse('2026-07-24T12:34:56.000Z'),
        },
      ],
      [
        olderFileName,
        {
          size: 70,
          mtimeMs: Date.parse('2026-07-24T12:30:00.000Z'),
        },
      ],
      [
        oldestFileName,
        {
          size: 10,
          mtimeMs: Date.parse('2026-07-24T12:00:00.000Z'),
        },
      ],
    ])
    const fs = {
      mkdirSync: vi.fn(),
      readdirSync: vi.fn(() => [...files.keys()]),
      statSync: vi.fn((filePath: string) => {
        const file = files.get(path.basename(filePath))

        if (file === undefined) {
          throw new Error(`missing file: ${filePath}`)
        }

        return {
          isFile: () => true,
          size: file.size,
          mtimeMs: file.mtimeMs,
        }
      }),
      unlinkSync: vi.fn((filePath: string) => {
        files.delete(path.basename(filePath))
      }),
      createWriteStream: vi.fn(() => ({
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      })),
    }

    const engine = createDiagnosticsEngine({
      config: {
        ...SURFACE_CONFIG,
        diagnostics: {
          ...SURFACE_CONFIG.diagnostics,
          ndjsonMaxTotalBytes: 200,
        },
        oscUi: {
          enabled: false,
          staticPeers: [],
          peerTtlMs: 0,
        },
      },
      getStatus: () => ({
        lastRttMs: null,
        consecutiveLosses: 0,
        lastPongSeq: null,
      }),
      interfacesProvider: () => [
        {
          address: '192.168.10.20',
          netmask: '255.255.255.0',
          family: 'IPv4',
          internal: false,
        },
      ],
      fs,
      now: () => Date.parse('2026-07-24T12:34:56.000Z'),
      logWarn,
      logError: vi.fn(),
    })

    expect(engine.snapshot().logUsage).toEqual({
      totalBytes: 200,
      limitBytes: 200,
      overLimit: false,
    })
    files.get(oldestFileName)!.size = 40
    vi.advanceTimersByTime(60_000)

    expect(fs.unlinkSync).toHaveBeenCalledTimes(2)
    expect(fs.unlinkSync).toHaveBeenNthCalledWith(1, path.join(logDir, oldestFileName))
    expect(fs.unlinkSync).toHaveBeenNthCalledWith(2, path.join(logDir, olderFileName))
    expect(engine.snapshot().logUsage).toEqual({
      totalBytes: 120,
      limitBytes: 200,
      overLimit: false,
    })

    expect(logWarn).toHaveBeenCalledTimes(1)
    expect(logWarn).toHaveBeenCalledWith(
      '(WARN, CUSTOM MODULE)',
      'Diagnostics log usage exceeded the configured limit; purging old logs automatically.',
    )

    engine.dispose()
  })
})
