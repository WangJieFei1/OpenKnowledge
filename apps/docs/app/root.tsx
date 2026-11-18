import {
  isRouteErrorResponse,
  Links,
  useLocation,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useParams,
} from 'react-router';
import { RootProvider } from 'fumadocs-ui/provider/react-router';
import { i18nProvider } from 'fumadocs-ui/i18n';
import type { Route } from './+types/root';
import './app.css';
import SearchDialog from '@/components/search';
import { i18n, resolveLanguage, type Language } from '@/lib/i18n';
import { translations } from '@/lib/layout.shared';
import NotFound from './routes/not-found';

export const links: Route.LinksFunction = () => [
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const language = resolveLanguage(params.lang) ?? i18n.defaultLanguage;
  const location = useLocation();
  const provider = i18nProvider(translations, language);

  function changeLanguage(nextLocale: string) {
    const nextLanguage = resolveLanguage(nextLocale);
    if (!nextLanguage) return;

    const segments = location.pathname.split('/').filter(Boolean);
    if (i18n.languages.includes(segments[0] as Language)) segments.shift();
    if (nextLanguage !== i18n.defaultLanguage) segments.unshift(nextLanguage);

    const pathname = `/${segments.join('/')}`;
    window.location.assign(`${pathname}${location.search}${location.hash}`);
  }

  return (
    <html lang={language === 'zh' ? 'zh-CN' : 'en'} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          i18n={{ ...provider, onLocaleChange: changeLanguage }}
          search={{ SearchDialog }}
        >
          {children}
        </RootProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'Oops!';
  let details = 'An unexpected error occurred.';
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) return <NotFound />;
    message = 'Error';
    details = error.statusText;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 w-full max-w-[1400px] mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
