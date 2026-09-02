import type { GlobeGenParams } from '@/core/spherical/config'
import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  SphericalHumanData,
  SphericalLanguage,
  SphericalNamingData,
  SphericalSettlement,
} from '@/core/spherical/society/society-data'
import type { SphericalRiverData } from '@/core/spherical/hydrology/hydrology-data'
import { deterministicUnit } from '@/core/spherical/geometry/spherical-math'

const NAMING_SEED = 241861
const HIGHLAND_NAME_ELEVATION = 1400

interface LanguageStyle {
  consonants: readonly string[]
  vowels: readonly string[]
  patterns: readonly string[]
}

const LANGUAGE_STYLES: readonly LanguageStyle[] = [
  {
    consonants: ['m', 'n', 'l', 'r', 's', 'v', 't', 'd', 'k'],
    vowels: ['a', 'e', 'i', 'o'],
    patterns: ['CV', 'CVC', 'VC', 'CV'],
  },
  {
    consonants: ['k', 'g', 't', 'd', 'r', 'n', 'm', 'kh', 'gr'],
    vowels: ['a', 'i', 'u', 'o'],
    patterns: ['CVC', 'CV', 'CCV', 'CVC'],
  },
  {
    consonants: ['s', 'sh', 'z', 'zh', 'l', 'n', 'r', 't', 'd'],
    vowels: ['a', 'e', 'i', 'u'],
    patterns: ['CV', 'VC', 'CVC', 'CV'],
  },
  {
    consonants: ['m', 'n', 'l', 'r', 'v', 'h', 's', 't'],
    vowels: ['a', 'e', 'i', 'o', 'u'],
    patterns: ['CV', 'V', 'CVV', 'CV'],
  },
  {
    consonants: ['p', 'b', 't', 'k', 'm', 'n', 'r', 'l', 'f'],
    vowels: ['a', 'i', 'u', 'o'],
    patterns: ['CVC', 'CV', 'VC', 'CVC'],
  },
  {
    consonants: ['th', 'ph', 'v', 'l', 'r', 'n', 'm', 's', 'c'],
    vowels: ['a', 'e', 'i', 'o', 'u', 'ae'],
    patterns: ['CV', 'CVC', 'VCV', 'CVV'],
  },
]

const OPTIONAL_CONSONANTS = [
  'b',
  'c',
  'f',
  'g',
  'h',
  'j',
  'p',
  'w',
  'y',
  'ch',
  'sk',
  'th',
] as const

export interface SphericalNamingGeneratorInput {
  climateElevationMeters: Float32Array
  rivers: SphericalRiverData
  human: SphericalHumanData
}

export class SphericalNamingGenerator {
  generate(
    mesh: SphericalMesh,
    input: SphericalNamingGeneratorInput,
    params: GlobeGenParams,
  ): SphericalNamingData {
    const familyByCulture = this.assignLanguageFamilies(mesh, input.human, params.seed)
    const languages = input.human.culture.cultures.map((_culture, culture) =>
      this.createLanguage(culture, familyByCulture[culture], params.seed),
    )
    const fallbackLanguage = this.createLanguage(-1, 0, params.seed)
    const familyNames: string[] = []
    const usedFamilyNames = new Set<string>()
    const cultureNames = new Set<string>()
    const settlementNames = new Set<string>()
    const polityNames = new Set<string>()
    const religionNames = new Set<string>()

    for (const language of languages) {
      if (familyNames[language.family])
        continue
      familyNames[language.family] = this.uniqueName(
        this.generateWord(language, params.seed, language.family, 67, 2, 3),
        usedFamilyNames,
        language,
        params.seed,
        language.family,
        71,
      )
    }

    for (let culture = 0; culture < input.human.culture.cultures.length; culture++) {
      const language = languages[culture]
      const name = this.uniqueName(
        this.generateWord(language, params.seed, culture, 101, 2, 3),
        cultureNames,
        language,
        params.seed,
        culture,
        109,
      )
      input.human.culture.cultures[culture].name = name
      input.human.culture.cultures[culture].language = culture
      language.name = name
    }

    for (let settlement = 0; settlement < input.human.settlements.length; settlement++) {
      const settlementData = input.human.settlements[settlement]
      const culture = input.human.culture.regionCulture[settlementData.region]
      const language = languages[culture] ?? fallbackLanguage
      const baseName = this.generateSettlementName(
        language,
        settlementData,
        settlement,
        input,
        params.seed,
      )
      settlementData.name = this.uniqueName(
        baseName,
        settlementNames,
        language,
        params.seed,
        settlement,
        211,
      )
    }

    for (let polity = 0; polity < input.human.politics.polities.length; polity++) {
      const polityData = input.human.politics.polities[polity]
      const capital = input.human.settlements[polityData.capitalSettlement]
      const culture = input.human.culture.regionCulture[polityData.capitalRegion]
      const language = languages[culture] ?? fallbackLanguage
      const usesCapitalName = deterministicUnit(NAMING_SEED + 17, params.seed, polity) < 0.34
      const baseName = usesCapitalName && capital?.name
        ? capital.name
        : this.generateWord(language, params.seed, polity, 307, 2, 3)
      polityData.name = this.uniqueName(
        baseName,
        polityNames,
        language,
        params.seed,
        polity,
        311,
      )
      polityData.adjective = this.generateWord(language, params.seed, polity, 313, 2, 2)
    }

    for (let religion = 0; religion < input.human.religion.religions.length; religion++) {
      const religionData = input.human.religion.religions[religion]
      const language = languages[religionData.originCulture] ?? fallbackLanguage
      religionData.name = this.uniqueName(
        this.generateWord(language, params.seed, religion, 401, 2, 3),
        religionNames,
        language,
        params.seed,
        religion,
        409,
      )
    }

    return { languages, familyNames }
  }

  private assignLanguageFamilies(
    mesh: SphericalMesh,
    human: SphericalHumanData,
    seed: number,
  ): Int16Array {
    const cultures = human.culture.cultures
    const result = new Int16Array(cultures.length).fill(-1)
    if (cultures.length === 0)
      return result
    const familyCount = Math.min(cultures.length, Math.max(1, Math.round(Math.sqrt(cultures.length))))
    const familySeeds = [Math.floor(
      deterministicUnit(NAMING_SEED + 23, seed, cultures.length) * cultures.length,
    )]
    while (familySeeds.length < familyCount) {
      let bestCulture = -1
      let bestDistance = -Infinity
      for (let culture = 0; culture < cultures.length; culture++) {
        if (familySeeds.includes(culture))
          continue
        let nearestSeed = Math.PI
        for (const familySeed of familySeeds) {
          nearestSeed = Math.min(
            nearestSeed,
            mesh.distanceBetweenRegions(
              cultures[culture].coreRegion,
              cultures[familySeed].coreRegion,
            ),
          )
        }
        if (nearestSeed > bestDistance) {
          bestDistance = nearestSeed
          bestCulture = culture
        }
      }
      if (bestCulture < 0)
        break
      familySeeds.push(bestCulture)
    }
    for (let culture = 0; culture < cultures.length; culture++) {
      let family = 0
      let nearestSeed = Infinity
      for (let candidate = 0; candidate < familySeeds.length; candidate++) {
        const distance = mesh.distanceBetweenRegions(
          cultures[culture].coreRegion,
          cultures[familySeeds[candidate]].coreRegion,
        )
        if (distance < nearestSeed) {
          nearestSeed = distance
          family = candidate
        }
      }
      result[culture] = family
    }
    return result
  }

  private createLanguage(culture: number, family: number, seed: number): SphericalLanguage {
    const styleOffset = Math.floor(
      deterministicUnit(NAMING_SEED + 31, seed) * LANGUAGE_STYLES.length,
    )
    const styleIndex = (styleOffset + Math.max(0, family)) % LANGUAGE_STYLES.length
    const style = LANGUAGE_STYLES[styleIndex]
    const consonants = [...style.consonants]
    const optional = OPTIONAL_CONSONANTS[Math.floor(
      deterministicUnit(NAMING_SEED + 37, seed, family, culture + 1)
      * OPTIONAL_CONSONANTS.length,
    )]
    if (!consonants.includes(optional))
      consonants.push(optional)
    const patterns = [...style.patterns]
    if (deterministicUnit(NAMING_SEED + 41, seed, family, culture + 1) > 0.58)
      patterns.push('CV')
    return {
      name: '',
      culture,
      family,
      consonants,
      vowels: [...style.vowels],
      syllablePatterns: patterns,
    }
  }

  private generateSettlementName(
    language: SphericalLanguage,
    settlement: SphericalSettlement,
    settlementId: number,
    input: SphericalNamingGeneratorInput,
    seed: number,
  ): string {
    const root = this.generateWord(language, seed, settlementId, 503, 2, 3)
    const feature = settlement.isPort
      ? 1
      : input.rivers.riverMask[settlement.region] !== 0
        ? 2
        : input.climateElevationMeters[settlement.region] >= HIGHLAND_NAME_ELEVATION
          ? 3
          : 0
    if (
      feature === 0
      || deterministicUnit(NAMING_SEED + 47, seed, language.culture, settlementId) > 0.46
    ) {
      return root
    }
    const suffix = this.generateSyllable(language, seed, feature, 0, 509).toLowerCase()
    return this.capitalize(`${root.toLowerCase()}${suffix}`)
  }

  private generateWord(
    language: SphericalLanguage,
    seed: number,
    entity: number,
    salt: number,
    minimumSyllables: number,
    maximumSyllables: number,
  ): string {
    const syllableSpan = maximumSyllables - minimumSyllables + 1
    const syllableCount = minimumSyllables + Math.floor(
      deterministicUnit(NAMING_SEED + salt, seed, language.culture + 1, entity) * syllableSpan,
    )
    let word = ''
    for (let syllable = 0; syllable < syllableCount; syllable++) {
      let part = this.generateSyllable(language, seed, entity, syllable, salt)
      if (part === word.slice(-part.length))
        part = this.generateSyllable(language, seed, entity, syllable, salt + 19)
      word += part
    }
    return this.capitalize(this.smoothWord(word))
  }

  private generateSyllable(
    language: SphericalLanguage,
    seed: number,
    entity: number,
    syllable: number,
    salt: number,
  ): string {
    const pattern = this.pick(
      language.syllablePatterns,
      seed,
      language.culture,
      entity * 17 + syllable,
      salt,
    )
    let result = ''
    for (let position = 0; position < pattern.length; position++) {
      const symbols = pattern[position] === 'V' ? language.vowels : language.consonants
      let symbol = this.pick(
        symbols,
        seed,
        language.culture,
        entity * 101 + syllable * 11 + position,
        salt + 7,
      )
      if (result.endsWith(symbol) && symbols.length > 1) {
        const current = symbols.indexOf(symbol)
        symbol = symbols[(current + 1) % symbols.length]
      }
      result += symbol
    }
    return result
  }

  private pick(
    values: string[],
    seed: number,
    culture: number,
    index: number,
    salt: number,
  ): string {
    const selected = Math.floor(
      deterministicUnit(NAMING_SEED + salt, seed, culture + 1, index) * values.length,
    )
    return values[selected]
  }

  private uniqueName(
    baseName: string,
    usedNames: Set<string>,
    language: SphericalLanguage,
    seed: number,
    entity: number,
    salt: number,
  ): string {
    let candidate = baseName
    for (let attempt = 0; attempt < 8; attempt++) {
      const key = candidate.toLowerCase()
      if (!usedNames.has(key)) {
        usedNames.add(key)
        return candidate
      }
      const suffix = this.generateSyllable(language, seed, entity, attempt, salt + attempt * 13)
      candidate = this.capitalize(`${baseName.toLowerCase()}${suffix}`)
    }
    const fallback = `${baseName}-${entity + 1}`
    usedNames.add(fallback.toLowerCase())
    return fallback
  }

  private smoothWord(word: string): string {
    return word
      .replace(/([aeiouy])\1+/g, '$1')
      .replace(/([^aeiouy])\1\1+/g, '$1$1')
  }

  private capitalize(word: string): string {
    return word.length > 0 ? `${word[0].toUpperCase()}${word.slice(1)}` : word
  }
}
