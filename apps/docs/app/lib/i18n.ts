import { defineI18n } from 'fumadocs-core/i18n';

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'zh'],
  hideLocale: 'default-locale',
  parser: 'dir',
  fallbackLanguage: null,
});

export type Language = (typeof i18n.languages)[number];

export function resolveLanguage(value: string | undefined): Language | null {
  if (value === undefined) return i18n.defaultLanguage;
  return i18n.languages.includes(value as Language) ? (value as Language) : null;
}

export function languageFromPath(pathname: string): Language {
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  return resolveLanguage(firstSegment) ?? i18n.defaultLanguage;
}

export function localizedPath(pathname: string, language: Language): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (language === i18n.defaultLanguage) return path;
  return `/${language}${path === '/' ? '' : path}`;
}
