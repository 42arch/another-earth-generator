import type { StageExecutionContext } from './index'
import { expect, it } from 'vitest'
import { copyDependency } from './copy-dependency'

it('does not visit or clone unselected payloads', () => {
  const source = { values: new Uint8Array([1, 2, 3]), get renderOnly(): never { throw new Error('unselected data was read') } }
  const context = { getDependency: () => source } as unknown as StageExecutionContext
  const selected = copyDependency<typeof source, { values: Uint8Array }>(context, 'mesh', value => ({ values: value.values }))
  expect(selected.values).toEqual(source.values)
  expect(selected.values).not.toBe(source.values)
  selected.values[0] = 99
  expect(source.values[0]).toBe(1)
})
