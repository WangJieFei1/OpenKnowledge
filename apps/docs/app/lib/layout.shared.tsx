import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { zhCN } from '@fumadocs/language/zh-cn';
import { uiTranslations } from 'fumadocs-ui/i18n';
import { i18n, localizedPath, type Language } from './i18n';
import { appName, gitConfig } from './shared';

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .preset('zh', zhCN())
  .add({
    en: { displayName: 'English' },
    zh: { displayName: '简体中文' },
  });

export function baseOptions(language: Language): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 font-semibold">
          <img src="/favicon.svg" alt="" className="size-6 rounded-md" />
          <span>{appName}</span>
        </span>
      ),
      url: localizedPath('/', language),
    },
    i18n,
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
