import { source } from '@/lib/source';
import { llms } from 'fumadocs-core/source';
import type { Route } from './+types/index';
import { resolveLanguage } from '@/lib/i18n';

export function loader({ params }: Route.LoaderArgs) {
  const language = resolveLanguage(params.lang);
  if (!language) return new Response('not found', { status: 404 });

  return new Response(llms(source).index(language), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
