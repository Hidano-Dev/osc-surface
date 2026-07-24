import type { DiagnosticsSnapshot, Reachability, SurfaceStatus } from '@osc-surface/shared'

export type PingOutcome = 'answered' | 'lost'

export type LossRateStats = DiagnosticsSnapshot['lossRate']

export class LossRateWindow {
  readonly windowSize: number

  private readonly outcomes: PingOutcome[]
  private head = 0
  private count = 0
  private lost = 0

  constructor(windowSize: number) {
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new Error('windowSize must be an integer greater than or equal to 1')
    }

    this.windowSize = windowSize
    this.outcomes = new Array<PingOutcome>(windowSize)
  }

  record(outcome: PingOutcome): void {
    if (outcome !== 'answered' && outcome !== 'lost') {
      throw new Error('outcome must be either "answered" or "lost"')
    }

    if (this.count < this.windowSize) {
      this.outcomes[(this.head + this.count) % this.windowSize] = outcome
      this.count += 1
    } else {
      const evicted = this.outcomes[this.head]
      if (evicted === 'lost') {
        this.lost -= 1
      }

      this.outcomes[this.head] = outcome
      this.head = (this.head + 1) % this.windowSize
    }

    if (outcome === 'lost') {
      this.lost += 1
    }
  }

  stats(): LossRateStats {
    return {
      windowSize: this.windowSize,
      observed: this.count,
      lost: this.lost,
      rate: this.count === 0 ? null : this.lost / this.count,
    }
  }
}

export function deriveReachability(status: SurfaceStatus): Reachability {
  if (status.consecutiveLosses >= 1) {
    return 'lost'
  }

  if (status.lastPongSeq !== null) {
    return 'reachable'
  }

  return 'unknown'
}
