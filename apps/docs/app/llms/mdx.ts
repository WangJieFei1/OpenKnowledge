import type { Route } from './+types/mdx';
import { getLLMText, source } from '@/lib/source';
import { resolveLanguage } from '@/lib/i18n';

export async function loader({ params }: Route.LoaderArgs) {
  const language = resolveLanguage(params.lang);
  if (!language) return new Response('not found', { status: 404 });

  const slugs = params['*'].split('/').filter((v) => v.length > 0);
  // remove the appended "content.md"
  slugs.pop();
  const page = source.getPage(slugs, language);
  if (!page) {
    return new Response('not found', { status: 404 });
  }
  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  });
}
