import { describe, expect, it } from 'vitest'

import {
  DownstreamFrameSchema,
  UpstreamFrameSchema,
  WIRE_PROTOCOL_VERSION,
  parseUpstreamFrame,
} from './wire'

const arg = { type: 'f' as const, value: 0.5 }

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
