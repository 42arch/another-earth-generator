import type { NamingStyleView } from '../../index'
import { describe, expect, it } from 'vitest'
import { DeterministicRandom, generateName, NAMING_ALGORITHM_VERSION, normalizeWorldSeed } from '../../index'

const style: NamingStyleView = {
  format: 'another-earth/naming-style',
  schemaVersion: 2,
  displayName: { en: 'Test' },
  id: 'test:naming/personal',
  style: 'chinese',
  language: 'zh-CN',
  version: '1',
  pools: {
    family: [{ value: '林', weight: 1 }],
    given: [{ value: '安', weight: 1 }],
    full: [{ value: 'Ada Lovelace', weight: 1 }],
  },
  rules: {
    familyFirst: [{ weight: 1, parts: [{ pool: 'family' }, { pool: 'given' }] }],
    givenFirst: [{ weight: 1, parts: [{ pool: 'given' }, { literal: '·' }, { pool: 'family' }] }],
    full: [{ weight: 1, parts: [{ pool: 'full' }] }],
    literal: [{ weight: 1, parts: [{ literal: '  The Nameless  ' }] }],
  },
}

const input = { style, styleSignature: 'personal-v1', worldSeed: 42, entityId: 'person:7', rule: 'familyFirst' }

function randomFor(value: typeof input): DeterministicRandom {
  return new DeterministicRandom(JSON.stringify([
    NAMING_ALGORITHM_VERSION,
    normalizeWorldSeed(value.worldSeed),
    value.entityId,
    value.style.id,
    value.style.version,
    value.styleSignature,
    value.rule,
  ]))
}

describe('generateName', () => {
  it('preserves name order, literal text and complete names', () => {
    expect(NAMING_ALGORITHM_VERSION).toBe('naming-v1')
    expect(generateName(input)).toBe('林安')
    expect(generateName({ ...input, rule: 'givenFirst' })).toBe('安·林')
    expect(generateName({ ...input, rule: 'full' })).toBe('Ada Lovelace')
    expect(generateName({ ...input, rule: 'literal' })).toBe('  The Nameless  ')
  })

  it('uses one template draw and one draw per pool, including single candidates', () => {
    const drawStyle: NamingStyleView = {
      ...style,
      pools: {
        fixed: [{ value: 'fixed', weight: 1 }],
        choice: [{ value: 'A', weight: 1 }, { value: 'B', weight: 3 }],
      },
      rules: {
        draw: [{ weight: 1, parts: [{ literal: '[' }, { pool: 'fixed' }, { literal: ':' }, { pool: 'choice' }, { pool: 'choice' }, { literal: ']' }] }],
      },
    }
    for (let i = 0; i < 32; i++) {
      const value = { ...input, style: drawStyle, rule: 'draw', entityId: `person:${i}` }
      const random = randomFor(value)
      random.nextFloat()
      random.nextFloat()
      const first = random.nextFloat() < 0.25 ? 'A' : 'B'
      const second = random.nextFloat() < 0.25 ? 'A' : 'B'
      expect(generateName(value)).toBe(`[fixed:${first}${second}]`)
    }
  })

  it('weights templates using all identity fields and normalizes numeric seeds', () => {
    const weightedStyle: NamingStyleView = {
      ...style,
      rules: {
        weighted: [{ weight: 1, parts: [{ literal: 'A' }] }, { weight: 3, parts: [{ literal: 'B' }] }],
        alternate: [{ weight: 1, parts: [{ literal: 'A' }] }, { weight: 3, parts: [{ literal: 'B' }] }],
      },
    }
    for (let i = 0; i < 32; i++) {
      const base = { ...input, style: weightedStyle, rule: 'weighted', entityId: `person:${i}` }
      const variants = [
        base,
        { ...base, worldSeed: 1024 },
        { ...base, styleSignature: 'personal-v2' },
        { ...base, style: { ...weightedStyle, id: 'test:naming/other' } },
        { ...base, style: { ...weightedStyle, version: '2' } },
        { ...base, rule: 'alternate' },
      ]
      for (const value of variants) {
        expect(generateName(value)).toBe(randomFor(value).nextFloat() < 0.25 ? 'A' : 'B')
        expect(generateName({ ...value, worldSeed: String(value.worldSeed) })).toBe(generateName(value))
      }
    }
  })

  it('repeats fixed seeds independently of other calls and entity input order', () => {
    const ids = ['person:1', 'person:2', 'person:3']
    const varied: NamingStyleView = {
      ...style,
      pools: { ...style.pools, given: [{ value: '安', weight: 1 }, { value: '宁', weight: 1 }] },
    }
    const names = ids.map(entityId => generateName({ ...input, style: varied, entityId }))
    generateName({ ...input, styleSignature: 'unrelated', worldSeed: 'other-world' })
    expect(ids.map(entityId => generateName({ ...input, style: varied, entityId }))).toEqual(names)
    expect([...ids].reverse().map(entityId => generateName({ ...input, style: varied, entityId })).reverse()).toEqual(names)
    const reordered: NamingStyleView = {
      ...varied,
      rules: Object.fromEntries(Object.entries(varied.rules).reverse()),
      pools: Object.fromEntries(Object.entries(varied.pools).reverse()),
      version: varied.version,
      id: varied.id,
    }
    expect(ids.map(entityId => generateName({ ...input, style: reordered, entityId }))).toEqual(names)
  })

  it('never selects zero-weight templates or pool entries', () => {
    const weighted: NamingStyleView = {
      ...style,
      pools: { choice: [{ value: 'never', weight: 0 }, { value: 'chosen', weight: 0.5 }, { value: 'never', weight: 0 }] },
      rules: {
        choice: [
          { weight: 0, parts: [{ literal: 'never' }] },
          { weight: 0.5, parts: [{ pool: 'choice' }] },
          { weight: 0, parts: [{ literal: 'never' }] },
        ],
      },
    }
    for (let i = 0; i < 32; i++)
      expect(generateName({ ...input, style: weighted, rule: 'choice', entityId: `person:${i}` })).toBe('chosen')
  })

  it.each(['', ' \t\n'])('rejects blank identity fields %j', (blank) => {
    for (const key of ['entityId', 'styleSignature', 'rule'] as const)
      expect(() => generateName({ ...input, [key]: blank })).toThrow(/cannot be empty/i)
    for (const key of ['id', 'style', 'language', 'version'] as const)
      expect(() => generateName({ ...input, style: { ...style, [key]: blank } })).toThrow(/cannot be empty/i)
    expect(() => generateName({ ...input, worldSeed: blank })).toThrow(/seed cannot be empty/i)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid numeric seed %s', (worldSeed) => {
    expect(() => generateName({ ...input, worldSeed })).toThrow(/seed must be a safe integer/i)
  })

  it.each(['missing', 'toString', 'constructor', '__proto__'])('rejects missing or inherited rule and pool %s', (key) => {
    expect(() => generateName({ ...input, rule: key })).toThrow(/rule.*missing/i)
    const missingPool: NamingStyleView = { ...style, rules: { name: [{ weight: 1, parts: [{ pool: key }] }] } }
    expect(() => generateName({ ...input, style: missingPool, rule: 'name' })).toThrow(/pool.*missing/i)
  })

  it('ignores inherited rule and pool arrays but accepts own special keys', () => {
    const inheritedRules: NamingStyleView = { ...style, rules: Object.create(style.rules) }
    expect(() => generateName({ ...input, style: inheritedRules })).toThrow(/rule.*missing/i)
    const inheritedPools: NamingStyleView = { ...style, pools: Object.create(style.pools) }
    expect(() => generateName({ ...input, style: inheritedPools })).toThrow(/pool.*missing/i)
    const ownKeys: NamingStyleView = {
      ...style,
      pools: { ['__proto__']: [{ value: 'Own', weight: 1 }] },
      rules: { toString: [{ weight: 1, parts: [{ pool: '__proto__' }] }] },
    }
    expect(generateName({ ...input, style: ownKeys, rule: 'toString' })).toBe('Own')
  })

  it('rejects empty rule and pool arrays', () => {
    expect(() => generateName({ ...input, style: { ...style, rules: { familyFirst: [] } } })).toThrow(/rule.*empty/i)
    expect(() => generateName({ ...input, style: { ...style, pools: { ...style.pools, family: [] } } })).toThrow(/pool.*empty/i)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects invalid weight %s in every candidate', (weight) => {
    const badRule: NamingStyleView = {
      ...style,
      rules: { name: [{ weight: 1, parts: [{ literal: 'valid' }] }, { weight, parts: [{ literal: 'invalid' }] }] },
    }
    expect(() => generateName({ ...input, style: badRule, rule: 'name' })).toThrow(/rule.*weight/i)
    const badPool: NamingStyleView = {
      ...style,
      pools: { ...style.pools, family: [{ value: 'valid', weight: 1 }, { value: 'invalid', weight }] },
    }
    expect(() => generateName({ ...input, style: badPool })).toThrow(/pool.*weight/i)
  })

  it.each([0, Number.MAX_VALUE])('rejects zero or overflowing total weight %s', (weight) => {
    const badRule: NamingStyleView = {
      ...style,
      rules: { name: [{ weight, parts: [{ literal: 'A' }] }, { weight, parts: [{ literal: 'B' }] }] },
    }
    expect(() => generateName({ ...input, style: badRule, rule: 'name' })).toThrow(/total weight/i)
    const badPool: NamingStyleView = {
      ...style,
      pools: { ...style.pools, family: [{ value: 'A', weight }, { value: 'B', weight }] },
    }
    expect(() => generateName({ ...input, style: badPool })).toThrow(/total weight/i)
  })

  it('rejects empty and whitespace-only results without retrying', () => {
    for (const parts of [[], [{ literal: ' \t' }], [{ pool: 'blank' }]]) {
      const blank: NamingStyleView = {
        ...style,
        pools: { blank: [{ value: '', weight: 1 }] },
        rules: { name: [{ weight: 1, parts }] },
      }
      expect(() => generateName({ ...input, style: blank, rule: 'name' })).toThrow(/name cannot be empty/i)
    }
  })
})
