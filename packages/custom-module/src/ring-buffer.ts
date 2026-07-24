export class RingBuffer<T> {
  readonly capacity: number

  private readonly items: T[]
  private head = 0
  private count = 0

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('capacity must be an integer greater than or equal to 1')
    }

    this.capacity = capacity
    this.items = new Array<T>(capacity)
  }

  get size(): number {
    return this.count
  }

  push(item: T): void {
    if (this.count < this.capacity) {
      this.items[(this.head + this.count) % this.capacity] = item
      this.count += 1
      return
    }

    this.items[this.head] = item
    this.head = (this.head + 1) % this.capacity
  }

  toArray(): readonly T[] {
    const snapshot = new Array<T>(this.count)

    for (let index = 0; index < this.count; index += 1) {
      snapshot[index] = this.items[(this.head + index) % this.capacity] as T
    }

    return snapshot
  }
}
