import type { WorldSimulationState } from '@/core/simulation/state'
import { expect, it } from 'vitest'
import { WorldColorizer } from '@/core/rendering/shared/world-colorizer'

it('colors the continent layer by final land and sea while retaining candidate continent IDs', () => {
  const data = {
    geography: {
      elevation: Float32Array.from([-0.2, 0.3, 0.1, -0.1]),
      landMask: Uint8Array.from([0, 1, 1, 0]),
      continentId: Int16Array.from([0, 0, -1, -1]),
      visibleContinentId: Int16Array.from([-1, 0, 0, -1]),
      terrainErosion: { flowAccumulation: new Float32Array(4) },
    },
  } as unknown as WorldSimulationState

  const colors = new WorldColorizer().build(data, 'continents')
  const colorAt = (region: number) => [...colors.subarray(region * 3, region * 3 + 3)]

  expect(colorAt(0)).toEqual(colorAt(3))
  expect(colorAt(1)).not.toEqual(colorAt(0))
  expect(colorAt(2)).toEqual(colorAt(1))
  expect(data.geography.continentId[0]).toBe(0)
  expect(data.geography.continentId[2]).toBe(-1)
})
