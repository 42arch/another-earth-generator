export type NumericArray = Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array | Int32Array
/** Owned storage. Never pass this object or its buffer to cartography/UI. */
export interface DenseField<T extends NumericArray> {
  readonly meshId: string
  readonly values: T
}
/** Zero-copy, read-only facade: exposes neither the array nor its backing buffer. */
export interface FieldView {
  readonly meshId: string
  readonly length: number
  get: (index: number) => number
}
export function createFieldView(field: DenseField<NumericArray>): FieldView {
  const { meshId, values } = field
  return Object.freeze({
    meshId,
    length: values.length,
    get(index: number) {
      if (!Number.isInteger(index) || index < 0 || index >= values.length)
        throw new RangeError('Invalid field index')
      return values[index]
    },
  })
}
