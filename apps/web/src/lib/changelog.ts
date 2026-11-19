/* eslint-disable regexp/no-super-linear-backtracking */
import changelogMarkdown from '../../../../CHANGELOG.md?raw'

export interface ChangelogItem {
  readonly en: string
  readonly zhCN: string
}

export interface ChangelogCategory {
  readonly title: string | null
  readonly items: readonly ChangelogItem[]
}

export interface ChangelogRelease {
  readonly version: string
  readonly categories: readonly ChangelogCategory[]
}

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: Array<{ version: string, categories: Array<{ title: string | null, items: ChangelogItem[] }> }> = []
  let release: (typeof releases)[number] | undefined
  let category: (typeof releases)[number]['categories'][number] | undefined

  for (const line of markdown.split(/\r?\n/)) {
    const versionHeading = line.match(/^##\s+v?(\S+)\s*$/)
    if (versionHeading) {
      release = { version: versionHeading[1]!, categories: [] }
      releases.push(release)
      category = undefined
      continue
    }

    const categoryHeading = line.match(/^###\s+(.+?)\s*$/)
    if (categoryHeading && release) {
      category = { title: categoryHeading[1]!, items: [] }
      release.categories.push(category)
      continue
    }

    const bullet = line.match(/^\s*-\s+(.+?)\s*$/)
    if (!bullet || !release)
      continue

    if (!category) {
      category = { title: null, items: [] }
      release.categories.push(category)
    }

    const text = bullet[1]!
    const bilingual = text.match(/^(.*?)\s+\(([^()]*)\)\s*$/)
    const hasChineseTranslation = bilingual?.[2] && /[\u3400-\u9FFF]/.test(bilingual[2])
    category.items.push(hasChineseTranslation
      ? { en: bilingual[1]!.trim(), zhCN: bilingual[2]!.trim() }
      : { en: text, zhCN: text })
  }

  return releases
}

export const changelog = parseChangelog(changelogMarkdown)
