import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'AI News Digest', template: '%s | AI News Digest' },
  description:
    '国内外のAI関連ニュースを1日2回自動で収集し、日本語の要約付きでまとめて配信するダイジェストサイト。',
  openGraph: {
    title: 'AI News Digest',
    description: '国内外のAI関連ニュースを1日2回、日本語の要約付きでまとめて配信します。',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#161a1d' },
  ],
};

/**
 * 静的書き出しなのでテーマは描画前にインラインで決める（切り替え時のちらつき防止）。
 * localStorage が使えない環境では OS 設定に従う。
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[4px] focus:bg-primary focus:px-4 focus:py-2 focus:text-white"
        >
          本文へスキップ
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto max-w-[960px] px-4 py-8 sm:px-6 sm:py-12">
          {children}
        </main>
        <footer className="border-t border-border bg-surface">
          <div className="mx-auto flex max-w-[960px] flex-col gap-2 px-4 py-8 text-[11px] leading-[1.6] text-text-secondary sm:px-6">
            <p className="jp-body">
              各記事の見出し・リンク・公開時刻は配信元の RSS / API から取得しています。本文は保存せず、
              要約は見出しと配信元の概要のみを根拠に生成しています。内容は必ず出典元でご確認ください。
            </p>
            <p>
              <Link href="/archive/" className="text-primary hover:underline">
                アーカイブ
              </Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
