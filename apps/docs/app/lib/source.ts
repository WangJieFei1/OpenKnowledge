import { createGetUrl, loader } from 'fumadocs-core/source';
import { docs } from 'collections/server';
import { docsContentRoute, docsRoute } from './shared';
import { i18n } from './i18n';

const getContentUrl = createGetUrl(docsContentRoute, i18n);

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute,
  i18n,
});

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md'];

  return {
    segments,
    url: getContentUrl(segments, page.locale),
  };
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
