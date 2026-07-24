import { SYS, StatsPayloadSchema } from '@osc-surface/shared'
import type { OscMessagePacket, OscPacket, StatsPayload } from '@osc-surface/shared'

import type { ScenarioRuntime } from './scenario'

export interface Clock {
  now(): Date
}

const DEFAULT_CLOCK: Clock = {
  now: () => new Date(),
}

export type FaultMode =
  | { kind: 'none' }
  | { kind: 'drop-pong' }
  | { kind: 'silent' }
  | { kind: 'random-loss'; rate: number }
  | { kind: 'delay'; ms: number }
  | { kind: 'corrupt' }

export type MockUnityReply =
  | {
      kind: 'message'
      packet: OscMessagePacket
      delayMs?: number
    }
  | {
      kind: 'raw'
      payload: Uint8Array
      delayMs?: number
    }

const DEFAULT_FAULT_MODE: FaultMode = { kind: 'none' }
const CORRUPT_PAYLOAD = Uint8Array.from([0xde, 0xad, 0xbe, 0xef])

export class MockUnityResponder {
  private received = 0
  private parseErrors = 0
  private lastReceivedAt = new Date(0).toISOString()
  private pongReplyCount = 0

  constructor(
    private readonly clock: Clock = DEFAULT_CLOCK,
    private readonly scenarioRuntime?: ScenarioRuntime,
    private readonly faultMode: FaultMode = DEFAULT_FAULT_MODE,
  ) {}

  handlePacket(packet: OscPacket): MockUnityReply[] {
    const replies: MockUnityReply[] = []
    this.visitPacket(packet, replies)
    return replies
  }

  recordParseError(): void {
    this.parseErrors += 1
  }

  statsSnapshot(): StatsPayload {
    return StatsPayloadSchema.parse({
      received: this.received,
      parseErrors: this.parseErrors,
      lastReceivedAt: this.lastReceivedAt,
    })
  }

  private visitPacket(packet: OscPacket, replies: MockUnityReply[]): void {
    if (isBundlePacket(packet)) {
      for (const nestedPacket of packet.packets) {
        this.visitPacket(nestedPacket, replies)
      }
      return
    }

    this.recordReceipt()

    if (packet.address === SYS.PING) {
      this.pushReply(
        replies,
        {
          address: SYS.PONG,
          args: packet.args,
        },
      )
      return
    }

    if (packet.address === SYS.STATS_REQUEST) {
      this.pushReply(replies, {
        address: SYS.STATS,
        args: [
          {
            type: 's',
            value: JSON.stringify(this.statsSnapshot()),
          },
        ],
      })
      return
    }

    if (packet.address === SYS.MANIFEST_REQUEST) {
      if (this.scenarioRuntime !== undefined) {
        this.pushReply(replies, {
          address: SYS.MANIFEST,
          args: [
            {
              type: 's',
              value: this.scenarioRuntime.manifestJson(),
            },
          ],
        })
      }
      return
    }

    if (packet.address.startsWith('/sys/')) {
      return
    }

    for (const arg of packet.args) {
      const value = toScenarioValue(arg.type, arg.value)
      if (value !== undefined) {
        this.scenarioRuntime?.recordValue(packet.address, value)
        break
      }
    }

    this.pushReply(replies, {
      address: packet.address,
      args: packet.args,
    })
  }

  private recordReceipt(): void {
    this.received += 1
    this.lastReceivedAt = this.clock.now().toISOString()
  }

  private pushReply(replies: MockUnityReply[], packet: OscMessagePacket): void {
    const filteredReply = this.applyFault(packet)

    if (filteredReply !== null) {
      replies.push(filteredReply)
    }
  }

  private applyFault(packet: OscMessagePacket): MockUnityReply | null {
    switch (this.faultMode.kind) {
      case 'none':
        return {
          kind: 'message',
          packet,
        }
      case 'silent':
        return null
      case 'drop-pong':
        return packet.address === SYS.PONG ? null : { kind: 'message', packet }
      case 'random-loss':
        if (packet.address !== SYS.PONG) {
          return {
            kind: 'message',
            packet,
          }
        }

        this.pongReplyCount += 1

        return shouldDropPong(this.pongReplyCount, this.faultMode.rate)
          ? null
          : {
              kind: 'message',
              packet,
            }
      case 'delay':
        return packet.address === SYS.PONG
          ? {
              kind: 'message',
              packet,
              delayMs: this.faultMode.ms,
            }
          : {
              kind: 'message',
              packet,
            }
      case 'corrupt':
        return {
          kind: 'raw',
          payload: CORRUPT_PAYLOAD.slice(),
        }
      default:
        return assertNever(this.faultMode)
    }
  }
}

function isBundlePacket(packet: OscPacket): packet is Extract<OscPacket, { packets: OscPacket[] }> {
  return 'timeTag' in packet && 'packets' in packet
}

function toScenarioValue(type: string, value: unknown): number | string | boolean | undefined {
  switch (type) {
    case 'i':
    case 'f':
      return typeof value === 'number' ? value : undefined
    case 's':
      return typeof value === 'string' ? value : undefined
    case 'T':
      return true
    case 'F':
      return false
    default:
      return undefined
  }
}

function shouldDropPong(sequence: number, rate: number): boolean {
  return Math.floor(sequence * rate) > Math.floor((sequence - 1) * rate)
}

function assertNever(value: never): never {
  throw new Error(`Unsupported fault mode: ${JSON.stringify(value)}`)
}
