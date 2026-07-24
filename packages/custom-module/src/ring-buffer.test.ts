import { describe, expect, it } from 'vitest'

import { RingBuffer } from './ring-buffer'

describe('RingBuffer', () => {
  it('stores items in insertion order before reaching capacity', () => {
    const buffer = new RingBuffer<number>(3)

    buffer.push(1)
    buffer.push(2)

    expect(buffer.size).toBe(2)
    expect(buffer.toArray()).toEqual([1, 2])
  })

  it('keeps only the most recent N items after reaching capacity', () => {
    const buffer = new RingBuffer<number>(3)

    buffer.push(1)
    buffer.push(2)
    buffer.push(3)
    buffer.push(4)

    expect(buffer.size).toBe(3)
    expect(buffer.toArray()).toEqual([2, 3, 4])
  })

  it('continues to return items from oldest to newest across multiple wraparounds', () => {
    const buffer = new RingBuffer<string>(2)

    buffer.push('a')
    buffer.push('b')
    buffer.push('c')
    buffer.push('d')

    expect(buffer.toArray()).toEqual(['c', 'd'])
  })

  it('returns a defensive copy from toArray', () => {
    const buffer = new RingBuffer<number>(2)

    buffer.push(1)
    buffer.push(2)

    const snapshot = buffer.toArray() as number[]
    snapshot.push(3)

    expect(buffer.toArray()).toEqual([1, 2])
  })

  it('rejects capacities smaller than 1 or non-integers', () => {
    expect(() => new RingBuffer(0)).toThrow('capacity must be an integer greater than or equal to 1')
    expect(() => new RingBuffer(1.5)).toThrow('capacity must be an integer greater than or equal to 1')
  })
})
