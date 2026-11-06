import type { StageExecutionContext } from './index'

/** Stage-owned working data. Native slice copies guarded arrays without per-element Proxy reads. */
export function copyDependency<T>(context: StageExecutionContext, id: string): T
export function copyDependency<T, R>(context: StageExecutionContext, id: string, select: (value: Readonly<T>) => R): R
export function copyDependency<T, R = T>(context: StageExecutionContext, id: string, select?: (value: Readonly<T>) => R): R {
  const copies = new WeakMap<object, object>()
  function copy(value: unknown): unknown {
    if (value === null || typeof value !== 'object')
      return value
    const existing = copies.get(value)
    if (existing)
      return existing
    // ArrayBuffer.isView does not recognize the read-only TypedArray proxies.
    if (value instanceof Uint8Array || value instanceof Uint8ClampedArray || value instanceof Int8Array
      || value instanceof Uint16Array || value instanceof Int16Array || value instanceof Uint32Array
      || value instanceof Int32Array || value instanceof Float32Array || value instanceof Float64Array
      || value instanceof BigInt64Array || value instanceof BigUint64Array) {
      const result = value.slice()
      copies.set(value, result)
      return result
    }
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new TypeError('Working dependencies must contain plain data and TypedArrays')
    const result: Record<string, unknown> = Array.isArray(value) ? [] as unknown as Record<string, unknown> : {}
    copies.set(value, result)
    for (const key of Object.keys(value))
      result[key] = copy((value as Record<string, unknown>)[key])
    return result
  }
  const dependency = context.getDependency<T>(id)
  // Selection still sees guarded borrows and declared-dependency checks. Only
  // selected values are cloned; aliases within the selection remain aliases.
  return copy(select ? select(dependency) : dependency) as R
}
