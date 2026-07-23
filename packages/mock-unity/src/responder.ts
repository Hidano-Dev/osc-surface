import { SYS, StatsPayloadSchema } from '@osc-surface/shared'
import type { OscMessagePacket, OscPacket, StatsPayload } from '@osc-surface/shared'

export interface Clock {
  now(): Date
}

const DEFAULT_CLOCK: Clock = {
  now: () => new Date(),
}

export class MockUnityResponder {
  private received = 0
  private parseErrors = 0
  private lastReceivedAt = new Date(0).toISOString()

  constructor(private readonly clock: Clock = DEFAULT_CLOCK) {}

  handlePacket(packet: OscPacket): OscMessagePacket[] {
    const replies: OscMessagePacket[] = []
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

  private visitPacket(packet: OscPacket, replies: OscMessagePacket[]): void {
    if (isBundlePacket(packet)) {
      for (const nestedPacket of packet.packets) {
        this.visitPacket(nestedPacket, replies)
      }
      return
    }

    this.recordReceipt()

    if (packet.address === SYS.PING) {
      replies.push({
        address: SYS.PONG,
        args: packet.args,
      })
      return
    }

    if (packet.address === SYS.STATS_REQUEST) {
      replies.push({
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

    if (packet.address.startsWith('/sys/')) {
      return
    }

    replies.push({
      address: packet.address,
      args: packet.args,
    })
  }

  private recordReceipt(): void {
    this.received += 1
    this.lastReceivedAt = this.clock.now().toISOString()
  }
}

function isBundlePacket(packet: OscPacket): packet is Extract<OscPacket, { packets: OscPacket[] }> {
  return 'timeTag' in packet && 'packets' in packet
}
