import { describe, expect, it } from 'vitest'

import { SurfaceStatusSchema } from '@oscdesk/shared'

import { PingMonitor } from './ping-monitor'

describe('PingMonitor', () => {
  it('records RTT and resets losses when the matching pong arrives', () => {
    const monitor = new PingMonitor()
    const seq = monitor.nextPing(100)

    expect(monitor.onPong(seq, 145)).toEqual({
      accepted: true,
      recoveredFromLoss: false,
    })
    expect(monitor.snapshot()).toEqual({
      lastRttMs: 45,
      consecutiveLosses: 0,
      lastPongSeq: 1,
    })
  })

  it('increments consecutive losses when the previous ping is still pending', () => {
    const monitor = new PingMonitor()

    expect(monitor.nextPing(100)).toBe(1)
    expect(monitor.nextPing(2100)).toBe(2)
    expect(monitor.snapshot()).toEqual({
      lastRttMs: null,
      consecutiveLosses: 1,
      lastPongSeq: null,
    })
  })

  it('ignores expired, unknown, and duplicate pongs', () => {
    const monitor = new PingMonitor()

    monitor.nextPing(100)
    monitor.nextPing(2100)

    expect(monitor.onPong(1, 2200)).toEqual({
      accepted: false,
      recoveredFromLoss: false,
    })
    expect(monitor.onPong(999, 2201)).toEqual({
      accepted: false,
      recoveredFromLoss: false,
    })
    expect(monitor.onPong(2, 2250)).toEqual({
      accepted: true,
      recoveredFromLoss: true,
    })
    expect(monitor.onPong(2, 2300)).toEqual({
      accepted: false,
      recoveredFromLoss: false,
    })
    expect(monitor.snapshot()).toEqual({
      lastRttMs: 150,
      consecutiveLosses: 0,
      lastPongSeq: 2,
    })
  })

  it('does not report recovery when the matching pong arrives without prior losses', () => {
    const monitor = new PingMonitor()

    const seq = monitor.nextPing(100)

    expect(monitor.onPong(seq, 125)).toEqual({
      accepted: true,
      recoveredFromLoss: false,
    })
  })

  it('exposes a snapshot compatible with SurfaceStatusSchema', () => {
    const monitor = new PingMonitor()

    monitor.nextPing(100)
    monitor.nextPing(2100)
    monitor.onPong(2, 2125)

    expect(SurfaceStatusSchema.parse(monitor.snapshot())).toEqual({
      lastRttMs: 25,
      consecutiveLosses: 0,
      lastPongSeq: 2,
    })
  })
})
