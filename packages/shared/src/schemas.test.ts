import { describe, expect, it } from 'vitest'

import {
  DiagnosticsSnapshotSchema,
  GuardEventRecordSchema,
  ManifestSchema,
  MessageRecordSchema,
  ReachabilitySchema,
  RecordedArgSchema,
  SubnetVerdictSchema,
  SurfaceDiagnosticsConfigSchema,
  StatsPayloadSchema,
  SurfaceConfigSchema,
  SurfaceStatusSchema,
} from './schemas'

describe('StatsPayloadSchema', () => {
  it('accepts a valid stats payload', () => {
    const result = StatsPayloadSchema.parse({
      received: 10,
      parseErrors: 1,
      lastReceivedAt: '2026-07-23T12:34:56.000Z',
    })

    expect(result.received).toBe(10)
  })

  it('accepts zero counters and offset timestamps', () => {
    const result = StatsPayloadSchema.parse({
      received: 0,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T21:34:56+09:00',
    })

    expect(result).toEqual({
      received: 0,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T21:34:56+09:00',
    })
  })

  it.each([
    [
      'negative counters and invalid timestamps',
      {
        received: -1,
        parseErrors: 0,
        lastReceivedAt: 'not-a-date',
      },
      ['received', 'lastReceivedAt'],
    ],
    [
      'non-integer counters',
      {
        received: 1.5,
        parseErrors: 0.5,
        lastReceivedAt: '2026-07-23T12:34:56.000Z',
      },
      ['received', 'parseErrors'],
    ],
    [
      'missing required fields',
      {
        received: 1,
      },
      ['parseErrors', 'lastReceivedAt'],
    ],
  ])('rejects %s', (_, payload, expectedPaths) => {
    const result = StatsPayloadSchema.safeParse(payload)

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(expectedPaths)
  })
})

describe('ManifestSchema', () => {
  it('accepts a valid manifest payload', () => {
    const result = ManifestSchema.parse({
      version: 1,
      projectId: 'osc-surface-demo',
      entries: [
        {
          address: '/avatar/blend/smile',
          label: 'Smile',
          type: 'f',
          widget: 'fader',
          range: [0, 1],
          default: 0,
          group: 'Face',
        },
      ],
    })

    expect(result.entries).toHaveLength(1)
  })

  it('accepts all supported manifest value shapes', () => {
    const result = ManifestSchema.parse({
      version: 1,
      projectId: 'osc-surface-demo',
      entries: [
        {
          address: '/avatar/blend/smile',
          label: 'Smile',
          type: 'f',
          widget: 'fader',
          range: [0, 1],
          default: 0.5,
          group: 'Face',
        },
        {
          address: '/avatar/toggle/visible',
          label: 'Visible',
          type: 'bool',
          widget: 'toggle',
          default: true,
        },
        {
          address: '/avatar/text/name',
          label: 'Name',
          type: 's',
          widget: 'text',
          default: 'OSC Surface',
        },
        {
          address: '/avatar/position',
          label: 'Position',
          type: 'b',
          widget: 'xy',
        },
        {
          address: '/avatar/action/reset',
          label: 'Reset',
          type: 'i',
          widget: 'button',
          default: 1,
        },
      ],
    })

    expect(result.entries).toHaveLength(5)
  })

  it.each([
    [
      'invalid enum values and address shapes',
      {
        version: 2,
        projectId: 'osc-surface-demo',
        entries: [
          {
            address: 'avatar/blend/smile',
            label: 'Smile',
            type: 'x',
            widget: 'dial',
          },
        ],
      },
      ['version', 'entries.0.address', 'entries.0.type', 'entries.0.widget'],
    ],
    [
      'invalid optional field shapes',
      {
        version: 1,
        projectId: 'osc-surface-demo',
        entries: [
          {
            address: '/avatar/blend/smile',
            label: 'Smile',
            type: 'f',
            widget: 'fader',
            range: [0],
            default: null,
            group: 1,
          },
        ],
      },
      ['entries.0.range', 'entries.0.default', 'entries.0.group'],
    ],
    [
      'missing required entry fields',
      {
        version: 1,
        projectId: 'osc-surface-demo',
        entries: [
          {
            address: '/avatar/blend/smile',
          },
        ],
      },
      ['entries.0.label', 'entries.0.type', 'entries.0.widget'],
    ],
  ])('rejects %s', (_, payload, expectedPaths) => {
    const result = ManifestSchema.safeParse(payload)

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(expectedPaths)
  })

  it.each([
    ['missing project identifier', { version: 1, entries: [] }],
    ['empty project identifier', { version: 1, projectId: '', entries: [] }],
    ['non-string project identifier', { version: 1, projectId: 42, entries: [] }],
  ])('rejects %s', (_, payload) => {
    expect(ManifestSchema.safeParse(payload).success).toBe(false)
  })
})

describe('SurfaceStatusSchema', () => {
  it('accepts valid status payloads', () => {
    const result = SurfaceStatusSchema.parse({
      lastRttMs: 42,
      consecutiveLosses: 0,
      lastPongSeq: 7,
    })

    expect(result.lastPongSeq).toBe(7)
  })

  it('accepts null optional fields', () => {
    const result = SurfaceStatusSchema.parse({
      lastRttMs: null,
      consecutiveLosses: 3,
      lastPongSeq: null,
    })

    expect(result).toEqual({
      lastRttMs: null,
      consecutiveLosses: 3,
      lastPongSeq: null,
    })
  })

  it.each([
    [
      'negative counters',
      {
        lastRttMs: -1,
        consecutiveLosses: -1,
        lastPongSeq: null,
      },
      ['lastRttMs', 'consecutiveLosses'],
    ],
    [
      'non-integer numeric values',
      {
        lastRttMs: 10.5,
        consecutiveLosses: 1.2,
        lastPongSeq: 7.1,
      },
      ['lastRttMs', 'consecutiveLosses', 'lastPongSeq'],
    ],
    [
      'missing required fields',
      {
        lastRttMs: null,
      },
      ['consecutiveLosses', 'lastPongSeq'],
    ],
  ])('rejects %s', (_, payload, expectedPaths) => {
    const result = SurfaceStatusSchema.safeParse(payload)

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(expectedPaths)
  })
})

describe('SurfaceConfigSchema', () => {
  it('accepts valid runtime config', () => {
    const result = SurfaceConfigSchema.parse({
      unity: {
        host: '127.0.0.1',
        sendPort: 9000,
        receivePort: 9001,
      },
      debug: false,
      boolFallbackToInt: true,
      diagnostics: {
        ringBufferSize: 300,
        lossRateWindow: 50,
        ndjsonDir: 'tmp/diag',
        ndjsonMaxTotalBytes: 1024,
      },
    })

    expect(result.unity.sendPort).toBe(9000)
  })

  it('accepts boundary port values', () => {
    const result = SurfaceConfigSchema.parse({
      unity: {
        host: 'localhost',
        sendPort: 1,
        receivePort: 65535,
      },
      debug: true,
      boolFallbackToInt: false,
    })

    expect(result.unity).toEqual({
      host: 'localhost',
      sendPort: 1,
      receivePort: 65535,
    })
    expect(result.diagnostics).toEqual({
      ringBufferSize: 200,
      lossRateWindow: 30,
      ndjsonDir: 'logs/diagnostics',
      ndjsonMaxTotalBytes: 52_428_800,
    })
  })

  it.each([
    [
      'nested field path errors',
      {
        unity: {
          host: '',
          sendPort: 0,
        },
        debug: 'false',
        boolFallbackToInt: false,
      },
      ['unity.host', 'unity.sendPort', 'unity.receivePort', 'debug'],
    ],
    [
      'ports outside the valid range',
      {
        unity: {
          host: '127.0.0.1',
          sendPort: 65536,
          receivePort: -1,
        },
        debug: false,
        boolFallbackToInt: true,
      },
      ['unity.sendPort', 'unity.receivePort'],
    ],
    [
      'non-integer ports and wrong boolean types',
      {
        unity: {
          host: '127.0.0.1',
          sendPort: 9000.5,
          receivePort: 9001.5,
        },
        debug: 1,
        boolFallbackToInt: 'true',
      },
      ['unity.sendPort', 'unity.receivePort', 'debug', 'boolFallbackToInt'],
    ],
    [
      'invalid diagnostics settings',
      {
        unity: {
          host: '127.0.0.1',
          sendPort: 9000,
          receivePort: 9001,
        },
        debug: false,
        boolFallbackToInt: true,
        diagnostics: {
          ringBufferSize: 0,
          lossRateWindow: 1001,
          ndjsonDir: '',
          ndjsonMaxTotalBytes: 0,
        },
      },
      [
        'diagnostics.ringBufferSize',
        'diagnostics.lossRateWindow',
        'diagnostics.ndjsonDir',
        'diagnostics.ndjsonMaxTotalBytes',
      ],
    ],
  ])('rejects %s', (_, payload, expectedPaths) => {
    const result = SurfaceConfigSchema.safeParse(payload)

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(expectedPaths)
  })

  it('accepts an omitted expected project identifier', () => {
    const result = SurfaceConfigSchema.parse({
      unity: { host: 'localhost', sendPort: 9000, receivePort: 9001 },
      debug: false,
      boolFallbackToInt: true,
    })

    expect(result.expectedProjectId).toBeUndefined()
  })

  it('rejects an empty expected project identifier', () => {
    const result = SurfaceConfigSchema.safeParse({
      unity: { host: 'localhost', sendPort: 9000, receivePort: 9001 },
      debug: false,
      boolFallbackToInt: true,
      expectedProjectId: '',
    })

    expect(result.success).toBe(false)
  })
})

describe('GuardEventRecordSchema', () => {
  it('accepts a project mismatch rejection record', () => {
    expect(
      GuardEventRecordSchema.parse({
        ts: '2026-07-26T12:34:56.000Z',
        kind: 'guard-reject',
        expectedProjectId: 'osc-surface-demo',
        receivedProjectId: 'other-project',
        peer: { host: '127.0.0.1', port: 9000 },
      }),
    ).toMatchObject({ kind: 'guard-reject', receivedProjectId: 'other-project' })
  })

  it('rejects malformed guard rejection records', () => {
    expect(
      GuardEventRecordSchema.safeParse({
        ts: 'not-a-date',
        kind: 'guard-reject',
        expectedProjectId: '',
        receivedProjectId: 42,
      }).success,
    ).toBe(false)
  })
})

describe('RecordedArgSchema', () => {
  it('accepts scalar and blob argument records', () => {
    expect(
      RecordedArgSchema.parse({
        kind: 'value',
        type: 's',
        value: 'hello',
        truncated: true,
      }),
    ).toEqual({
      kind: 'value',
      type: 's',
      value: 'hello',
      truncated: true,
    })

    expect(
      RecordedArgSchema.parse({
        kind: 'blob',
        byteLength: 128,
      }),
    ).toEqual({
      kind: 'blob',
      byteLength: 128,
    })
  })

  it('rejects invalid discriminated union members', () => {
    const result = RecordedArgSchema.safeParse({
      kind: 'blob',
      value: 'unexpected',
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(['byteLength'])
  })
})

describe('MessageRecordSchema', () => {
  it('accepts message records with optional peer metadata', () => {
    const result = MessageRecordSchema.parse({
      ts: '2026-07-24T12:34:56.000Z',
      dir: 'out',
      address: '/avatar/parameter',
      args: [
        {
          kind: 'value',
          type: 'f',
          value: 0.5,
        },
      ],
      peer: {
        host: '127.0.0.1',
        port: 9000,
      },
    })

    expect(result.peer?.port).toBe(9000)
  })

  it('rejects invalid message records', () => {
    const result = MessageRecordSchema.safeParse({
      ts: 'not-a-date',
      dir: 'sideways',
      address: 'avatar/parameter',
      args: [],
      peer: {
        host: '',
        port: 0,
      },
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'ts',
      'dir',
      'address',
      'peer.host',
      'peer.port',
    ])
  })
})

describe('SubnetVerdictSchema', () => {
  it('accepts all supported subnet verdict variants', () => {
    expect(SubnetVerdictSchema.parse({ kind: 'sameHost' })).toEqual({ kind: 'sameHost' })
    expect(
      SubnetVerdictSchema.parse({
        kind: 'sameSubnet',
        matchedInterface: 'Ethernet 1',
      }),
    ).toEqual({
      kind: 'sameSubnet',
      matchedInterface: 'Ethernet 1',
    })
    expect(
      SubnetVerdictSchema.parse({
        kind: 'differentSubnet',
        checkedInterfaces: 2,
      }),
    ).toEqual({
      kind: 'differentSubnet',
      checkedInterfaces: 2,
    })
    expect(
      SubnetVerdictSchema.parse({
        kind: 'indeterminate',
        reason: 'hostname',
      }),
    ).toEqual({
      kind: 'indeterminate',
      reason: 'hostname',
    })
  })

  it('rejects unsupported subnet verdict payloads', () => {
    const result = SubnetVerdictSchema.safeParse({
      kind: 'differentSubnet',
      checkedInterfaces: 0,
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'checkedInterfaces',
    ])
  })
})

describe('ReachabilitySchema', () => {
  it('accepts supported reachability values', () => {
    expect(ReachabilitySchema.parse('unknown')).toBe('unknown')
    expect(ReachabilitySchema.parse('reachable')).toBe('reachable')
    expect(ReachabilitySchema.parse('lost')).toBe('lost')
  })

  it('rejects unsupported reachability values', () => {
    const result = ReachabilitySchema.safeParse('pending')

    expect(result.success).toBe(false)
  })
})

describe('DiagnosticsSnapshotSchema', () => {
  it('accepts a valid diagnostics snapshot', () => {
    const result = DiagnosticsSnapshotSchema.parse({
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
        totalBytes: 1024,
        limitBytes: 2048,
        overLimit: false,
      },
      recentMessages: [
        {
          ts: '2026-07-24T12:34:56.000Z',
          dir: 'in',
          address: '/sys/pong',
          args: [],
        },
      ],
    })

    expect(result.lossRate.rate).toBe(0.1)
  })

  it('rejects invalid diagnostics snapshots', () => {
    const result = DiagnosticsSnapshotSchema.safeParse({
      reachability: 'pending',
      lastRttMs: -1,
      consecutiveLosses: -1,
      lossRate: {
        windowSize: 0,
        observed: -1,
        lost: -1,
        rate: 1.5,
      },
      subnet: {
        kind: 'indeterminate',
        reason: 'dns',
      },
      logUsage: {
        totalBytes: -1,
        limitBytes: 0,
        overLimit: 'no',
      },
      recentMessages: [
        {
          ts: 'bad-date',
          dir: 'in',
          address: 'sys/pong',
          args: [],
        },
      ],
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'reachability',
      'lastRttMs',
      'consecutiveLosses',
      'lossRate.windowSize',
      'lossRate.observed',
      'lossRate.lost',
      'lossRate.rate',
      'subnet.reason',
      'logUsage.totalBytes',
      'logUsage.limitBytes',
      'logUsage.overLimit',
      'recentMessages.0.ts',
      'recentMessages.0.address',
    ])
  })
})

describe('SurfaceDiagnosticsConfigSchema', () => {
  it('applies defaults when the diagnostics block is omitted', () => {
    expect(SurfaceDiagnosticsConfigSchema.parse(undefined)).toEqual({
      ringBufferSize: 200,
      lossRateWindow: 30,
      ndjsonDir: 'logs/diagnostics',
      ndjsonMaxTotalBytes: 52_428_800,
    })
  })

  it('applies field defaults when the diagnostics block is partial', () => {
    expect(
      SurfaceDiagnosticsConfigSchema.parse({
        ringBufferSize: 500,
      }),
    ).toEqual({
      ringBufferSize: 500,
      lossRateWindow: 30,
      ndjsonDir: 'logs/diagnostics',
      ndjsonMaxTotalBytes: 52_428_800,
    })
  })
})
