import type { NamingStyle, NamingStyleParseResult } from '../schemas/naming-style'
import { canonical, hash } from '../content-hash'
import { parseNamingStyle } from './parse-naming-style'

export function decodeNamingStyleJson(text: string): NamingStyleParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  }
  catch {
    return { valid: false, issues: [{ code: 'dtype', path: '$', message: 'Invalid JSON' }] }
  }
  return parseNamingStyle(value)
}

export function requireNamingStyle(value: unknown): NamingStyle {
  const parsed = parseNamingStyle(value)
  if (!parsed.valid)
    throw new TypeError(`Invalid naming style at ${parsed.issues[0].path}: ${parsed.issues[0].message}`)
  return parsed.value
}

export function encodeNamingStyleJson(style: NamingStyle): string {
  return `${JSON.stringify(JSON.parse(canonical(requireNamingStyle(style))), null, 2)}\n`
}

/** Presentation and attribution changes do not perturb generated names. */
export function calculateNamingStyleSignature(style: NamingStyle): string {
  const { schemaVersion, id, style: namingStyle, language, version, pools, rules } = requireNamingStyle(style)
  return `naming-style-v2:${hash(canonical({ schemaVersion, id, style: namingStyle, language, version, pools, rules }))}`
}
