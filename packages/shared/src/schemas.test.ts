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

  it('reports field paths for invalid stats payloads', () => {
    const result = StatsPayloadSchema.safeParse({
      received: -1,
      parseErrors: 0,
      lastReceivedAt: 'not-a-date',
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'received',
      'lastReceivedAt',
    ])
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

  it('rejects invalid manifest enum values and address shapes', () => {
    const result = ManifestSchema.safeParse({
      version: 2,
      entries: [
        {
          address: 'avatar/blend/smile',
          label: 'Smile',
          type: 'x',
          widget: 'dial',
        },
      ],
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'version',
      'entries.0.address',
      'entries.0.type',
      'entries.0.widget',
    ])
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

  it('rejects negative counters', () => {
    const result = SurfaceStatusSchema.safeParse({
      lastRttMs: -1,
      consecutiveLosses: -1,
      lastPongSeq: null,
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'lastRttMs',
      'consecutiveLosses',
    ])
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

  it('reports nested field paths for invalid runtime config', () => {
    const result = SurfaceConfigSchema.safeParse({
      unity: {
        host: '',
        sendPort: 0,
      },
      debug: 'false',
      boolFallbackToInt: false,
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'unity.host',
      'unity.sendPort',
      'unity.receivePort',
      'debug',
    ])
  })
})
