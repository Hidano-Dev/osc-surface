import type { SurfaceStatus } from '@osc-surface/shared'

type PendingPing = {
  seq: number
  sentAtMs: number
}

export class PingMonitor {
  private nextSeq = 1
  private pending: PendingPing | null = null
  private lastRttMs: number | null = null
  private consecutiveLosses = 0
  private lastPongSeq: number | null = null

  nextPing(nowMs: number): number {
    if (this.pending !== null) {
      this.consecutiveLosses += 1
    }

    const seq = this.nextSeq
    this.nextSeq += 1
    this.pending = {
      seq,
      sentAtMs: nowMs,
    }

    return seq
  }

  onPong(seq: number, nowMs: number): boolean {
    if (this.pending === null || this.pending.seq !== seq) {
      return false
    }

    this.lastRttMs = Math.max(0, nowMs - this.pending.sentAtMs)
    this.consecutiveLosses = 0
    this.lastPongSeq = seq
    this.pending = null

    return true
  }

  snapshot(): SurfaceStatus {
    return {
      lastRttMs: this.lastRttMs,
      consecutiveLosses: this.consecutiveLosses,
      lastPongSeq: this.lastPongSeq,
    }
  }
}
