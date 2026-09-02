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
