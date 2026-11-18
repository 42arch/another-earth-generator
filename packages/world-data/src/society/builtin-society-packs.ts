import type { ContentPack, ContentPackV1 } from '../schemas/content'
import culturesEnglish from '../../data/society/cultures-en.json'
import culturesChinese from '../../data/society/cultures-zh-cn.json'
import statesEnglish from '../../data/society/states-en.json'
import statesChinese from '../../data/society/states-zh-cn.json'
import peoplesEnglish from '../../data/society/peoples-en.json'
import peoplesChinese from '../../data/society/peoples-zh-cn.json'
import { parseSocietyPack } from './parse-society-pack'
import { createSocietyPack } from './society-pack'

/** Candidate definitions only; world generation decides their actual population and identity. */
export function loadBuiltinSocietyPacks(namingStylePacks: readonly ContentPackV1[]): readonly ContentPackV1[] {
  const sources = [peoplesEnglish, peoplesChinese, culturesEnglish, culturesChinese, statesEnglish, statesChinese]
  return sources.map((source) => {
    const parsed = parseSocietyPack(source)
    if (!parsed.valid)
      throw new TypeError(`Invalid built-in society pack at ${parsed.issues[0].path}: ${parsed.issues[0].message}`)
    const dependencies = parsed.value.dependencies.map((dependency) => {
      const pack = namingStylePacks.find(candidate => candidate.manifest.id === dependency.id)
      if (!pack || pack.manifest.version !== dependency.version)
        throw new TypeError(`Missing built-in society dependency ${dependency.id}@${dependency.version}`)
      return pack
    })
    return createSocietyPack(parsed.value, dependencies)
  })
}
