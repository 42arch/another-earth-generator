import alea from 'alea'
import { describe, expect, it } from 'vitest'
import { AleaRandom, DeterministicRandom, normalizeWorldSeed, stableHash, stageRandom } from './random'

describe('deterministic random streams', () => {
  it('repeats streams for the same seed and separates different seeds and stages', () => {
    // A stream is stateful; compare complete sequences from fresh instances.
    const sequence = (seed: string, stage: string) => {
      const random = stageRandom(seed, stage, '1')
      return Array.from({ length: 8 }, () => random.nextFloat())
    }
    expect(sequence('42', 'mesh')).toEqual(sequence('42', 'mesh'))
    expect(sequence('42', 'mesh').slice(0, 4)).toEqual([0.5726317327935249, 0.0918761461507529, 0.036818076157942414, 0.8201122402679175])
    expect(sequence('42', 'mesh')).not.toEqual(sequence('100', 'mesh'))
    expect(sequence('42', 'mesh')).not.toEqual(sequence('42', 'climate'))
  })

  it('forks by immutable namespace, independent of parent draws or fork order', () => {
    const parent = new DeterministicRandom('world/mesh')
    const first = parent.fork('region:7')
    parent.nextFloat()
    parent.fork('region:8').nextFloat()
    expect(first.nextFloat()).toBe(new DeterministicRandom('world/mesh').fork('region:7').nextFloat())
    expect(parent.fork('region:7').nextFloat()).toBe(new DeterministicRandom('world/mesh').fork('region:7').nextFloat())
    expect(parent.fork('region:7').nextFloat()).not.toBe(parent.fork('region:8').nextFloat())
  })

  it('uses stable UTF-16 hashing and rejects ambiguous numeric seeds', () => {
    expect(stableHash('Earth 🌍')).toBe('2df494be329685a7')
    expect(stableHash('Earth 🌍')).not.toBe(stableHash('Earth 🌎'))
    expect(normalizeWorldSeed(42)).toBe('42')
    expect(() => normalizeWorldSeed(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
    expect(() => normalizeWorldSeed(' ')).toThrow(RangeError)
    expect(() => new DeterministicRandom('x').fork('')).toThrow(RangeError)
  })

  it('keeps root alea draws byte-for-byte compatible and forks independently of state', () => {
    const legacy = alea('42')
    const random = new AleaRandom('42')
    for (let i = 0; i < 32; i++)
      expect(random.nextFloat()).toBe(legacy())
    const a = random.fork('region:7')
    random.nextFloat()
    const b = new AleaRandom('42').fork('region:7')
    expect(Array.from({ length: 8 }, () => a.nextFloat())).toEqual(Array.from({ length: 8 }, () => b.nextFloat()))
    expect(new AleaRandom('42').fork('region:8').nextFloat()).not.toBe(b.nextFloat())
  })

  it('returns bounded deterministic integers from both implementations', () => {
    for (const source of [new AleaRandom('42'), new DeterministicRandom('42')]) {
      const values = Array.from({ length: 100 }, () => source.nextInt(-3, 4))
      expect(values.every(value => Number.isInteger(value) && value >= -3 && value < 4)).toBe(true)
      expect(() => source.nextInt(2, 2)).toThrow(RangeError)
      expect(() => source.nextInt(0, Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
    }
    expect(new AleaRandom('42').nextInt(0, 100)).toBe(new AleaRandom('42').nextInt(0, 100))
  })
})
