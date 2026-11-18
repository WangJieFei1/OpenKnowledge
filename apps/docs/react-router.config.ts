import type { Config } from '@react-router/dev/config';
import { glob } from 'node:fs/promises';
import { createGetUrl, getSlugs } from 'fumadocs-core/source';
import { i18n, localizedPath } from './app/lib/i18n';

const getDocsUrl = createGetUrl('/docs', i18n);
const getContentUrl = createGetUrl('/llms.mdx/docs', i18n);

export default {
  ssr: false,
  async prerender({ getStaticPaths }) {
    const paths = new Set(getStaticPaths());

    for (const language of i18n.languages) {
      paths.add(localizedPath('/', language));
      paths.add(localizedPath('/llms.txt', language));
      paths.add(localizedPath('/llms-full.txt', language));
    }

    for await (const entry of glob('**/*.mdx', { cwd: 'content/docs' })) {
      const [language, ...slugs] = getSlugs(entry);
      if (!i18n.languages.includes(language as (typeof i18n.languages)[number])) continue;

      paths.add(getDocsUrl(slugs, language));
      paths.add(getContentUrl([...slugs, 'content.md'], language));
    }

    return [...paths];
  },
} satisfies Config;
