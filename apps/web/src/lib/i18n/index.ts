import { appState } from '@/ui/state/app.svelte'
import en from './en.json'
import zhCN from './zh-CN.json'

export const locales = ['zh-CN', 'en'] as const
export type Locale = (typeof locales)[number]

const messages = { 'zh-CN': zhCN, en } satisfies Record<Locale, typeof zhCN>

type TranslationPath<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Record<string, unknown>
      ? `${K}.${TranslationPath<T[K]>}`
      : never
}[keyof T & string]

export type MessageKey = TranslationPath<typeof zhCN>

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const value = key.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null)
      return undefined
    return (current as Record<string, unknown>)[segment]
  }, messages[appState.locale])
  if (typeof value !== 'string')
    return key
  return value.replace(/\{(\w+)\}/g, (placeholder, name: string) => `${params[name] ?? placeholder}`)
}

export function setLocale(locale: Locale): void {
  appState.locale = locale
  document.documentElement.lang = locale
  try {
    localStorage.setItem('another-earth-locale', locale)
  }
  catch {
    // The language still changes for this session if browser storage is unavailable.
  }
}

export function initializeLocale(): void {
  let savedLocale: string | null = null
  try {
    savedLocale = localStorage.getItem('another-earth-locale')
  }
  catch {
    // Fall back to the browser language when storage is unavailable.
  }
  const browserLocale = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
  const locale: Locale = savedLocale === 'zh-CN' || savedLocale === 'en' ? savedLocale : browserLocale
  appState.locale = locale
  document.documentElement.lang = locale
}
