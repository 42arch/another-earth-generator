interface Prioritized {
  cost: number
}

export class MinPriorityQueue<T extends Prioritized> {
  private readonly items: T[] = []

  get size(): number {
    return this.items.length
  }

  push(item: T): void {
    this.items.push(item)
    let index = this.items.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.items[parent].cost <= item.cost)
        break
      this.items[index] = this.items[parent]
      index = parent
    }
    this.items[index] = item
  }

  pop(): T {
    const first = this.items[0]
    const last = this.items.pop()!
    if (this.items.length === 0)
      return first

    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= this.items.length)
        break
      let child = left
      if (right < this.items.length && this.items[right].cost < this.items[left].cost)
        child = right
      if (this.items[child].cost >= last.cost)
        break
      this.items[index] = this.items[child]
      index = child
    }
    this.items[index] = last
    return first
  }
}

/**
 * A highly optimized priority queue specifically for mapping integer IDs
 * to float costs, backed by TypedArrays to avoid GC overhead in tight loops.
 */
export class IndexPriorityQueue {
  private ids: Int32Array
  private costs: Float32Array
  public size = 0

  constructor(initialCapacity = 16384) {
    this.ids = new Int32Array(initialCapacity)
    this.costs = new Float32Array(initialCapacity)
  }

  push(id: number, cost: number): void {
    if (this.size === this.ids.length) {
      const newCapacity = this.size * 2
      const newIds = new Int32Array(newCapacity)
      newIds.set(this.ids)
      this.ids = newIds
      const newCosts = new Float32Array(newCapacity)
      newCosts.set(this.costs)
      this.costs = newCosts
    }

    let index = this.size++
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.costs[parent] <= cost)
        break
      this.ids[index] = this.ids[parent]
      this.costs[index] = this.costs[parent]
      index = parent
    }
    this.ids[index] = id
    this.costs[index] = cost
  }

  pop(): number {
    const firstId = this.ids[0]
    this.size--
    if (this.size === 0)
      return firstId

    const lastId = this.ids[this.size]
    const lastCost = this.costs[this.size]
    
    let index = 0
    while (true) {
      const left = (index << 1) + 1
      const right = left + 1
      if (left >= this.size)
        break
      let child = left
      if (right < this.size && this.costs[right] < this.costs[left])
        child = right
      if (this.costs[child] >= lastCost)
        break
      this.ids[index] = this.ids[child]
      this.costs[index] = this.costs[child]
      index = child
    }
    this.ids[index] = lastId
    this.costs[index] = lastCost
    return firstId
  }
}
