import { describe, expect, it } from 'vitest'

import {
  ManifestSchema,
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
  ])('rejects %s', (_, payload, expectedPaths) => {
    const result = SurfaceConfigSchema.safeParse(payload)

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(expectedPaths)
  })
})
