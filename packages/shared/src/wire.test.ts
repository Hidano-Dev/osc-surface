import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  DownstreamFrameSchema,
  UpstreamFrameSchema,
  WIRE_PROTOCOL_VERSION,
  parseUpstreamFrame,
} from './wire'

const arg = { type: 'f' as const, value: 0.5 }

const wireSamples = JSON.parse(
  readFileSync(new URL('../../../protocol/wire-samples.json', import.meta.url), 'utf8'),
) as {
  protocolVersion: number
  cases: Array<{
    name: string
    direction: 'downstream' | 'upstream'
    valid: boolean
    frame: unknown
  }>
}

describe('WireSchemas', () => {
  it('accepts all downstream frame kinds', () => {
    const frames = [
      {
        v: 1,
        type: 'hello',
        clientId: 'ui-1',
        protocolVersion: 1,
        server: { name: 'oscdesk', version: '0.1.0' },
        unity: { host: '127.0.0.1', sendPort: 9000 },
        bridge: { oscListenPort: 9001, wsPort: 8080 },
        expectedProjectId: null,
        heartbeat: { intervalMs: 1000, timeoutMs: 3000 },
        pingIntervalMs: 1000,
        debug: false,
      },
      { v: 1, type: 'manifest', manifest: { version: 1, projectId: 'demo', entries: [] } },
      { v: 1, type: 'osc', address: '/value', args: [arg], from: { host: '127.0.0.1', port: 9000 } },
      {
        v: 1,
        type: 'link',
        unity: { reachability: 'reachable', lastRttMs: 5, consecutiveLosses: 0, lastPongSeq: 2 },
        manifest: { state: 'none' },
        lastRejection: null,
      },
      { v: 1, type: 'heartbeat', t: 123 },
      { v: 1, type: 'notice', level: 'warn', code: 'bad-frame', detail: 'discarded' },
    ]

    for (const frame of frames) expect(DownstreamFrameSchema.safeParse(frame).success).toBe(true)
  })

  it('accepts all upstream frame kinds and preserves one argument in an array', () => {
    const frames = [
      { v: WIRE_PROTOCOL_VERSION, type: 'osc', address: '/value', args: [arg] },
      { v: 1, type: 'manifestRequest' },
      { v: 1, type: 'heartbeatAck', t: 123 },
    ]

    for (const frame of frames) expect(UpstreamFrameSchema.safeParse(frame).success).toBe(true)
    expect(UpstreamFrameSchema.parse(frames[0])).toMatchObject({ args: [arg] })
  })

  it('rejects legacy arrays, unknown keys, and incompatible versions', () => {
    expect(UpstreamFrameSchema.safeParse(['sendOsc', {}]).success).toBe(false)
    expect(UpstreamFrameSchema.safeParse({ v: 1, type: 'manifestRequest', extra: true }).success).toBe(false)
    expect(DownstreamFrameSchema.safeParse({ v: 2, type: 'heartbeat', t: 1 }).success).toBe(false)
  })

  it('validates every hand-authored wire sample by direction', () => {
    expect(wireSamples.protocolVersion).toBe(WIRE_PROTOCOL_VERSION)
    expect(wireSamples.cases).not.toHaveLength(0)

    for (const sample of wireSamples.cases) {
      const schema = sample.direction === 'downstream' ? DownstreamFrameSchema : UpstreamFrameSchema
      const result = schema.safeParse(sample.frame)

      if (!sample.valid) {
        expect(result.success, sample.name).toBe(false)
        continue
      }

      expect(result.success, sample.name).toBe(true)

      if (sample.direction === 'downstream') {
        // TS validates decoded downstream data by semantic JSON round-trip.
        // Python's downstream assertion instead checks the decoded value object.
        expect(JSON.parse(JSON.stringify(result.data))).toEqual(sample.frame)
      }
      // TS only asserts that valid upstream data is accepted. Python's upstream
      // assertion compares encoder output with the hand-authored sample exactly;
      // Python does not claim to reject invalid upstream frames because it does
      // not generate them.
    }
  })

  it('parses JSON and reports invalid JSON or schema errors', () => {
    expect(parseUpstreamFrame('{"v":1,"type":"manifestRequest"}')).toEqual({
      ok: true,
      value: { v: 1, type: 'manifestRequest' },
    })
    expect(parseUpstreamFrame('{')).toEqual({ ok: false, error: 'invalid-json' })
    expect(parseUpstreamFrame('{"v":1,"type":"unknown"}')).toEqual({
      ok: false,
      error: 'schema-error',
    })
  })
})
