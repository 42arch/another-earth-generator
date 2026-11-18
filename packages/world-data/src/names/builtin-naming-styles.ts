import type { NamingStyle } from '../schemas/naming-style'
import westernEnglish from '../../data/name-styles/western-en.json'
import westernChinese from '../../data/name-styles/western-zh-CN.json'
import { requireNamingStyle } from './naming-style'

/** Opt-in examples, separate from the legacy natural-world content catalog. */
export function loadBuiltinNamingStyles(): readonly NamingStyle[] {
  return [requireNamingStyle(westernChinese), requireNamingStyle(westernEnglish)]
}
