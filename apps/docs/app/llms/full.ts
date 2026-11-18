import { getLLMText, source } from '@/lib/source';
import type { Route } from './+types/full';
import { resolveLanguage } from '@/lib/i18n';

export async function loader({ params }: Route.LoaderArgs) {
  const language = resolveLanguage(params.lang);
  if (!language) return new Response('not found', { status: 404 });

  const scan = source.getPages(language).map(getLLMText);
  const scanned = await Promise.all(scan);

  return new Response(scanned.join('\n\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
