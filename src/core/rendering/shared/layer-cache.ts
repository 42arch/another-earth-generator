interface VisibleObject {
  visible: boolean
}

/** Builders own resource disposal; the cache only tracks validity and visibility. */
export class LayerCache<T extends VisibleObject> {
  private readonly entries = new Map<string, { revision: unknown, valid: boolean, objects: T[] }>()

  sync(key: string, visible: boolean, revision: unknown, build: () => T[]): void {
    let entry = this.entries.get(key)
    if (visible && (!entry || !entry.valid || entry.revision !== revision)) {
      entry = { revision, valid: true, objects: build() }
      this.entries.set(key, entry)
    }
    if (entry) {
      for (const object of entry.objects)
        object.visible = visible
    }
  }

  invalidate(predicate: (key: string) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (predicate(key))
        entry.valid = false
    }
  }

  clear(): void {
    this.entries.clear()
  }
}
