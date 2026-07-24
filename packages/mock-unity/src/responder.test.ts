import { describe, expect, it } from 'vitest'

import { ManifestSchema, SYS, StatsPayloadSchema } from '@osc-surface/shared'
import type { OscPacket } from '@osc-surface/shared'

import { MockUnityResponder, type MockUnityReply } from './responder'
import { ScenarioRuntime, ScenarioSchema } from './scenario'

describe('MockUnityResponder', () => {
  it('replies to /sys/ping with /sys/pong carrying the same seq', () => {
    const responder = new MockUnityResponder(createClock())

    const replies = responder.handlePacket({
      address: SYS.PING,
      args: [{ type: 'i', value: 7 }],
    })

    expect(replies).toEqual([
      {
        kind: 'message',
        packet: {
          address: SYS.PONG,
          args: [{ type: 'i', value: 7 }],
        },
      },
    ])
  })

  it('replies to /sys/stats/request with a schema-valid JSON payload', () => {
    const responder = new MockUnityResponder(createClock())

    responder.handlePacket({
      address: '/avatar/float',
      args: [{ type: 'f', value: 0.5 }],
    })
    const replies = responder.handlePacket({
      address: SYS.STATS_REQUEST,
      args: [],
    })

    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({
      kind: 'message',
      packet: {
        address: SYS.STATS,
        args: [{ type: 's' }],
      },
    })

    const [payloadArg] = getMessagePacket(replies[0]).args
    expect(payloadArg.type).toBe('s')
    const payload = StatsPayloadSchema.parse(JSON.parse(payloadArg.value as string))

    expect(payload).toEqual({
      received: 2,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:01.000Z',
    })
  })

  it('does not echo unknown /sys/* messages', () => {
    const responder = new MockUnityResponder(createClock())

    const replies = responder.handlePacket({
      address: SYS.MANIFEST_REQUEST,
      args: [],
    })

    expect(replies).toEqual([])
    expect(responder.statsSnapshot()).toEqual({
      received: 1,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:00.000Z',
    })
  })

  it('replies to /sys/manifest/request with a schema-valid manifest JSON when a scenario is configured', () => {
    const responder = new MockUnityResponder(
      createClock(),
      createScenarioRuntime({
        entries: [
          {
            address: '/avatar/text/name',
            label: '{characterName}',
            type: 's',
            widget: 'text',
            default: '{characterName}',
          },
        ],
      }),
    )

    const replies = responder.handlePacket({
      address: SYS.MANIFEST_REQUEST,
      args: [],
    })

    expect(replies).toEqual([
      {
        kind: 'message',
        packet: {
          address: SYS.MANIFEST,
          args: [{ type: 's', value: expect.any(String) }],
        },
      },
    ])
    expect(
      ManifestSchema.parse(JSON.parse(String(getMessagePacket(replies[0]).args[0]?.value))).entries[0],
    ).toMatchObject({
      address: '/avatar/text/name',
      default: '蛻晞浹繝溘け',
    })
  })

  it('reflects echoed non-/sys/* values into the next manifest response', () => {
    const responder = new MockUnityResponder(
      createClock(),
      createScenarioRuntime({
        entries: [
          {
            address: '/avatar/blend/smile',
            label: 'Smile',
            type: 'f',
            widget: 'fader',
            range: [0, 1],
            default: 0.25,
          },
        ],
      }),
    )

    const echoReplies = responder.handlePacket({
      address: '/avatar/blend/smile',
      args: [{ type: 'f', value: 0.75 }],
    })
    const manifestReplies = responder.handlePacket({
      address: SYS.MANIFEST_REQUEST,
      args: [],
    })

    expect(echoReplies).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/avatar/blend/smile',
          args: [{ type: 'f', value: 0.75 }],
        },
      },
    ])
    expect(
      ManifestSchema.parse(JSON.parse(String(getMessagePacket(manifestReplies[0]).args[0]?.value))).entries[0],
    ).toMatchObject({
      address: '/avatar/blend/smile',
      default: 0.75,
    })
  })

  it('echoes non-/sys/* messages and expands bundles per message', () => {
    const responder = new MockUnityResponder(createClock())
    const packet: OscPacket = {
      timeTag: {
        seconds: 1,
        fractions: 2,
      },
      packets: [
        {
          address: '/avatar/int',
          args: [{ type: 'i', value: 1 }],
        },
        {
          timeTag: {
            seconds: 3,
            fractions: 4,
          },
          packets: [
            {
              address: '/avatar/name',
              args: [{ type: 's', value: 'surface' }],
            },
          ],
        },
      ],
    }

    const replies = responder.handlePacket(packet)

    expect(replies).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/avatar/int',
          args: [{ type: 'i', value: 1 }],
        },
      },
      {
        kind: 'message',
        packet: {
          address: '/avatar/name',
          args: [{ type: 's', value: 'surface' }],
        },
      },
    ])
    expect(responder.statsSnapshot()).toEqual({
      received: 2,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:01.000Z',
    })
  })

  it('tracks parse errors independently from successful receipts', () => {
    const responder = new MockUnityResponder(createClock())

    responder.recordParseError()
    responder.recordParseError()
    responder.handlePacket({
      address: '/avatar/blob',
      args: [{ type: 'b', value: Uint8Array.from([1, 2, 3]) }],
    })

    expect(responder.statsSnapshot()).toEqual({
      received: 1,
      parseErrors: 2,
      lastReceivedAt: '2026-07-23T00:00:00.000Z',
    })
  })

  it('drops only /sys/pong replies in drop-pong mode', () => {
    const responder = new MockUnityResponder(createClock(), undefined, { kind: 'drop-pong' })

    expect(
      responder.handlePacket({
        address: SYS.PING,
        args: [{ type: 'i', value: 1 }],
      }),
    ).toEqual([])
    expect(
      responder.handlePacket({
        address: '/avatar/toggle',
        args: [{ type: 'i', value: 1 }],
      }),
    ).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/avatar/toggle',
          args: [{ type: 'i', value: 1 }],
        },
      },
    ])
    expect(responder.statsSnapshot()).toEqual({
      received: 2,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:01.000Z',
    })
  })

  it('suppresses all replies in silent mode while keeping receipt counters', () => {
    const responder = new MockUnityResponder(createClock(), undefined, { kind: 'silent' })

    expect(
      responder.handlePacket({
        address: SYS.PING,
        args: [{ type: 'i', value: 2 }],
      }),
    ).toEqual([])
    expect(
      responder.handlePacket({
        address: SYS.STATS_REQUEST,
        args: [],
      }),
    ).toEqual([])
    expect(responder.statsSnapshot()).toEqual({
      received: 2,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:01.000Z',
    })
  })

  it('drops /sys/pong replies in a deterministic random-loss pattern', () => {
    const responder = new MockUnityResponder(createClock(), undefined, {
      kind: 'random-loss',
      rate: 0.5,
    })

    const replies = Array.from({ length: 6 }, (_, index) =>
      responder.handlePacket({
        address: SYS.PING,
        args: [{ type: 'i', value: index + 1 }],
      }),
    )

    expect(replies).toEqual([
      [{ kind: 'message', packet: { address: SYS.PONG, args: [{ type: 'i', value: 1 }] } }],
      [],
      [{ kind: 'message', packet: { address: SYS.PONG, args: [{ type: 'i', value: 3 }] } }],
      [],
      [{ kind: 'message', packet: { address: SYS.PONG, args: [{ type: 'i', value: 5 }] } }],
      [],
    ])
  })

  it('attaches delay instructions only to /sys/pong replies in delay mode', () => {
    const responder = new MockUnityResponder(createClock(), undefined, { kind: 'delay', ms: 150 })

    const pongReplies = responder.handlePacket({
      address: SYS.PING,
      args: [{ type: 'i', value: 8 }],
    })
    const echoReplies = responder.handlePacket({
      address: '/avatar/float',
      args: [{ type: 'f', value: 0.25 }],
    })

    expect(pongReplies).toEqual([
      {
        kind: 'message',
        packet: {
          address: SYS.PONG,
          args: [{ type: 'i', value: 8 }],
        },
        delayMs: 150,
      },
    ])
    expect(echoReplies).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/avatar/float',
          args: [{ type: 'f', value: 0.25 }],
        },
      },
    ])
  })

  it('replaces replies with invalid raw payloads in corrupt mode', () => {
    const responder = new MockUnityResponder(createClock(), undefined, { kind: 'corrupt' })

    const replies = responder.handlePacket({
      address: '/avatar/name',
      args: [{ type: 's', value: 'surface' }],
    })

    expect(replies).toEqual([
      {
        kind: 'raw',
        payload: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
      },
    ])
    expect(responder.statsSnapshot()).toEqual({
      received: 1,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:00.000Z',
    })
  })
})

function createClock() {
  let tick = 0

  return {
    now() {
      const date = new Date(`2026-07-23T00:00:0${tick}.000Z`)
      tick += 1
      return date
    },
  }
}

function createScenarioRuntime(overrides: {
  entries: Array<Record<string, unknown>>
}) {
  return new ScenarioRuntime(
    ScenarioSchema.parse({
      characterName: {
        candidates: ['蛻晞浹繝溘け'],
      },
      ...overrides,
    }),
    { characterName: '蛻晞浹繝溘け' },
  )
}

function getMessagePacket(reply: MockUnityReply | undefined) {
  expect(reply?.kind).toBe('message')
  return (reply as Extract<MockUnityReply, { kind: 'message' }>).packet
}
