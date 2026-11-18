import type { NamingStyle } from '../index'
import { describe, expect, it } from 'vitest'
import { calculateNamingStyleSignature, decodeNamingStyleJson, encodeNamingStyleJson, parseNamingStyle } from '../index'

function style(): NamingStyle {
  return {
    format: 'another-earth/naming-style',
    schemaVersion: 2,
    id: 'test:naming-style/western-zh-cn',
    style: 'western',
    language: 'zh-CN',
    version: '1.0.0',
    displayName: { 'zh-CN': '中式命名' },
    pools: {
      family: [{ value: '林', weight: 1 }, { value: '沈', weight: 2 }],
      given: [{ value: '清和', weight: 1 }],
    },
    rules: { person: [{ weight: 1, parts: [{ pool: 'family' }, { literal: ' ' }, { pool: 'given' }] }] },
  }
}

describe('naming style JSON', () => {
  it('round trips names, literal whitespace, array order and author metadata', () => {
    const input = { ...style(), author: 'Example author', source: 'Original examples' }
    const decoded = decodeNamingStyleJson(encodeNamingStyleJson(input))
    expect(decoded.valid).toBe(true)
    if (!decoded.valid)
      throw new Error('Expected a valid naming style')
    expect(decoded.value).toEqual(input)
    expect(encodeNamingStyleJson(decoded.value)).toBe(encodeNamingStyleJson(input))
  })

  it('returns a detached value and canonicalizes object keys only', () => {
    const input = style()
    const parsed = parseNamingStyle(input)
    expect(parsed.valid).toBe(true)
    if (!parsed.valid)
      throw new Error('Expected a valid naming style')
    expect(parsed.value).not.toBe(input)
    expect(parsed.value.pools.family).not.toBe(input.pools.family)
    const reordered = { ...input, pools: { given: input.pools.given, family: input.pools.family } }
    expect(encodeNamingStyleJson(reordered)).toBe(encodeNamingStyleJson(input))
    expect(calculateNamingStyleSignature(reordered)).toBe(calculateNamingStyleSignature(input))
    expect(calculateNamingStyleSignature({ ...input, pools: { ...input.pools, family: [...input.pools.family].reverse() } })).not.toBe(calculateNamingStyleSignature(input))
  })

  it('keeps presentation metadata out of the generation signature', () => {
    const input = style()
    expect(calculateNamingStyleSignature({ ...input, displayName: { en: 'Renamed' }, author: 'Someone' })).toBe(calculateNamingStyleSignature(input))
    expect(calculateNamingStyleSignature({ ...input, style: 'chinese', id: 'test:naming-style/chinese-zh-cn' })).not.toBe(calculateNamingStyleSignature(input))
    expect(calculateNamingStyleSignature({ ...input, language: 'en', id: 'test:naming-style/western-en' })).not.toBe(calculateNamingStyleSignature(input))
    expect(calculateNamingStyleSignature({ ...input, version: '1.0.1' })).not.toBe(calculateNamingStyleSignature(input))
    expect(calculateNamingStyleSignature({ ...input, rules: { person: [{ weight: 1, parts: [{ pool: 'given' }] }] } })).not.toBe(calculateNamingStyleSignature(input))
  })

  it('returns structured errors for malformed JSON', () => {
    expect(decodeNamingStyleJson('{')).toMatchObject({ valid: false, issues: [{ path: '$' }] })
    expect(decodeNamingStyleJson('null').valid).toBe(false)
  })

  it.each<[string, () => unknown]>([
    ['unsupported schema', () => ({ ...style(), schemaVersion: 1 })],
    ['wrong format', () => ({ ...style(), format: 'other' })],
    ['unknown field', () => ({ ...style(), script: 'ignored()' })],
    ['invalid content ID', () => ({ ...style(), id: 'chinese' })],
    ['invalid style', () => ({ ...style(), style: 'Western' })],
    ['invalid language', () => ({ ...style(), language: 'zh_CN' })],
    ['mismatched profile id', () => ({ ...style(), id: 'test:naming-style/western-en' })],
    ['invalid version', () => ({ ...style(), version: 'latest' })],
    ['missing labels', () => ({ ...style(), displayName: {} })],
    ['empty label', () => ({ ...style(), displayName: { en: ' ' } })],
    ['empty pools', () => ({ ...style(), pools: {} })],
    ['empty pool', () => ({ ...style(), pools: { family: [] } })],
    ['sparse pool', () => ({ ...style(), pools: { family: Object.assign(Array.from({ length: 2 }), { 1: { value: '林', weight: 1 } }) } })],
    ['empty candidate', () => ({ ...style(), pools: { family: [{ value: ' ', weight: 1 }] } })],
    ['negative weight', () => ({ ...style(), pools: { family: [{ value: '林', weight: -1 }] } })],
    ['nonfinite weight', () => ({ ...style(), pools: { family: [{ value: '林', weight: Infinity }] } })],
    ['zero total weight', () => ({ ...style(), pools: { family: [{ value: '林', weight: 0 }] } })],
    ['overflowing total', () => ({ ...style(), pools: { family: [{ value: '林', weight: Number.MAX_VALUE }, { value: '沈', weight: Number.MAX_VALUE }] } })],
    ['empty rules', () => ({ ...style(), rules: {} })],
    ['empty alternatives', () => ({ ...style(), rules: { person: [] } })],
    ['zero template weight', () => ({ ...style(), rules: { person: [{ weight: 0, parts: [{ pool: 'family' }] }] } })],
    ['empty template', () => ({ ...style(), rules: { person: [{ weight: 1, parts: [] }] } })],
    ['whitespace name', () => ({ ...style(), rules: { person: [{ weight: 1, parts: [{ literal: ' ' }] }] } })],
    ['unknown pool', () => ({ ...style(), rules: { person: [{ weight: 1, parts: [{ pool: 'absent' }] }] } })],
    ['inherited pool', () => ({ ...style(), rules: { person: [{ weight: 1, parts: [{ pool: 'toString' }] }] } })],
    ['ambiguous part', () => ({ ...style(), rules: { person: [{ weight: 1, parts: [{ pool: 'family', literal: '林' }] }] } })],
    ['recursive rule', () => ({ ...style(), rules: { person: [{ weight: 1, parts: [{ rule: 'person' }] }] } })],
  ])('rejects %s without throwing', (_label, input) => {
    const result = parseNamingStyle(input())
    expect(result.valid).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues.every(issue => issue.path.length > 0)).toBe(true)
  })

  it('accepts fractional and zero weights when a positive candidate exists', () => {
    const input = style()
    expect(parseNamingStyle({ ...input, pools: { ...input.pools, family: [{ value: '林', weight: 0 }, { value: '沈', weight: 0.5 }] } }).valid).toBe(true)
  })
})
