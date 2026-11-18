import type { Route } from './+types/home';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Link } from 'react-router';
import { baseOptions } from '@/lib/layout.shared';
import { BookOpen } from 'lucide-react';
import { localizedPath, resolveLanguage } from '@/lib/i18n';
import { docsRoute } from '@/lib/shared';

export function loader({ params }: Route.LoaderArgs) {
  const language = resolveLanguage(params.lang);
  if (!language) throw new Response('Not found', { status: 404 });
  return { language };
}

export function meta({ params }: Route.MetaArgs) {
  const language = resolveLanguage(params.lang);
  const isChinese = language === 'zh';

  return [
    { title: isChinese ? 'Open Knowledge 文档' : 'Open Knowledge Documentation' },
    {
      name: 'description',
      content: isChinese
        ? 'Open Knowledge 的 Markdown 文档编辑与整理说明。'
        : 'A concise guide to organizing and editing Markdown with Open Knowledge.',
    },
  ];
}

export default function Home({ loaderData: { language } }: Route.ComponentProps) {
  const isChinese = language === 'zh';

  return (
    <HomeLayout {...baseOptions(language)}>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16 sm:py-24">
        <img src="/favicon.svg" alt="" className="mb-6 size-12 rounded-lg" />
        <h1 className="text-3xl font-semibold sm:text-4xl">Open Knowledge</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-fd-muted-foreground sm:text-lg">
          {isChinese
            ? '内容范围包括 Markdown 工作区、文档编辑、属性管理和本机工具连接。'
            : 'This guide covers opening Markdown folders, writing, managing properties, and connecting local tools.'}
        </p>
        <Link
          className="mt-8 inline-flex w-fit items-center gap-2 rounded-md bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground"
          to={localizedPath(docsRoute, language)}
        >
          <BookOpen className="size-4" />
          {isChinese ? '打开文档' : 'Read the guide'}
        </Link>
        <div className="mt-12 grid gap-6 border-t pt-8 sm:grid-cols-3">
          {(isChinese
            ? [
                ['Markdown 文件', '文件以普通 Markdown 格式保存在工作区中'],
                ['编辑视图', '富文本和 Markdown 源代码视图均受支持'],
                ['工具兼容性', '同一组文件由 Git、同步服务和受支持的本机 AI 工具处理'],
              ]
            : [
                ['Markdown first', 'Files remain ordinary Markdown inside their folder'],
                ['Two editor views', 'Rich text and Markdown source are both available'],
                ['Works with existing tools', 'Git, sync, and supported local AI tools use the same files'],
              ]
          ).map(([title, description]) => (
            <section key={title}>
              <h2 className="text-sm font-medium">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">{description}</p>
            </section>
          ))}
        </div>
      </main>
    </HomeLayout>
  );
}
