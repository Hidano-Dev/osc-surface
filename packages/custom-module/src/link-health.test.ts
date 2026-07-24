import { describe, expect, it } from 'vitest'

import { ReachabilitySchema } from '@osc-surface/shared'

import { deriveReachability, LossRateWindow } from './link-health'

describe('LossRateWindow', () => {
  it('reports null rate before any ping outcome has been observed', () => {
    const window = new LossRateWindow(3)

    expect(window.stats()).toEqual({
      windowSize: 3,
      observed: 0,
      lost: 0,
      rate: null,
    })
  })

  it('tracks answered and lost outcomes while the window is not yet full', () => {
    const window = new LossRateWindow(4)

    window.record('answered')
    window.record('lost')
    window.record('answered')

    expect(window.stats()).toEqual({
      windowSize: 4,
      observed: 3,
      lost: 1,
      rate: 1 / 3,
    })
  })

  it('evicts the oldest outcomes once more than W results are recorded', () => {
    const window = new LossRateWindow(3)

    window.record('lost')
    window.record('answered')
    window.record('lost')
    window.record('answered')

    expect(window.stats()).toEqual({
      windowSize: 3,
      observed: 3,
      lost: 1,
      rate: 1 / 3,
    })
  })

  it('rejects invalid window sizes', () => {
    expect(() => new LossRateWindow(0)).toThrow('windowSize must be an integer greater than or equal to 1')
    expect(() => new LossRateWindow(1.5)).toThrow('windowSize must be an integer greater than or equal to 1')
  })
})

describe('deriveReachability', () => {
  it('returns lost when at least one consecutive ping has been lost', () => {
    expect(
      ReachabilitySchema.parse(
        deriveReachability({
          lastRttMs: null,
          consecutiveLosses: 1,
          lastPongSeq: 10,
        }),
      ),
    ).toBe('lost')
  })

  it('returns reachable after at least one pong has been accepted with no active losses', () => {
    expect(
      ReachabilitySchema.parse(
        deriveReachability({
          lastRttMs: 42,
          consecutiveLosses: 0,
          lastPongSeq: 7,
        }),
      ),
    ).toBe('reachable')
  })

  it('returns unknown before the first accepted pong arrives', () => {
    expect(
      ReachabilitySchema.parse(
        deriveReachability({
          lastRttMs: null,
          consecutiveLosses: 0,
          lastPongSeq: null,
        }),
      ),
    ).toBe('unknown')
  })
})
