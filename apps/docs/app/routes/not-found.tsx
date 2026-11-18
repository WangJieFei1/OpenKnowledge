import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Link, useLocation } from 'react-router';
import { baseOptions } from '@/lib/layout.shared';
import { languageFromPath, localizedPath } from '@/lib/i18n';
import { docsRoute } from '@/lib/shared';

export function meta() {
  return [{ title: 'Not Found' }];
}

export default function NotFound() {
  const language = languageFromPath(useLocation().pathname);
  const isChinese = language === 'zh';

  return (
    <HomeLayout {...baseOptions(language)}>
      <div className="p-4 flex flex-col items-center justify-center text-center flex-1">
        <h1 className="text-xl font-bold mb-2">{isChinese ? '找不到页面' : 'Page not found'}</h1>
        <p className="text-fd-muted-foreground mb-4">
          {isChinese ? '请求的文档路径不存在。' : 'The requested documentation path does not exist.'}
        </p>
        <Link
          className="rounded-md bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground"
          to={localizedPath(docsRoute, language)}
        >
          {isChinese ? '返回文档' : 'Back to documentation'}
        </Link>
      </div>
    </HomeLayout>
  );
}
