'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Article, Category, DigestFile, IndexEntry } from '@/lib/types';
import { CATEGORIES } from '@/lib/types';
import { formatDateLabel, formatTime } from '@/lib/format';
import ArticleCard from './ArticleCard';
import { ChevronDownIcon } from './Icons';

type Props = {
  digest: DigestFile;
  dates: IndexEntry[];
};

function groupByCategory(articles: Article[]): { category: Category; articles: Article[] }[] {
  return CATEGORIES.map((category) => ({
    category,
    articles: articles.filter((a) => a.category === category),
  })).filter((section) => section.articles.length > 0);
}

export default function DigestBrowser({ digest, dates }: Props) {
  const router = useRouter();
  const [active, setActive] = useState<Category | 'すべて'>('すべて');

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const article of digest.articles) {
      map.set(article.category, (map.get(article.category) ?? 0) + 1);
    }
    return map;
  }, [digest.articles]);

  const visible = useMemo(
    () => (active === 'すべて' ? digest.articles : digest.articles.filter((a) => a.category === active)),
    [active, digest.articles],
  );

  const sections = useMemo(() => groupByCategory(visible), [visible]);
  const chips: (Category | 'すべて')[] = ['すべて', ...CATEGORIES.filter((c) => (counts.get(c) ?? 0) > 0)];

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-[24px] font-bold leading-[1.4] tracking-[-0.01em] text-text-primary">
            {formatDateLabel(digest.date)} のダイジェスト
          </h2>
          <p className="tabular text-[13px] leading-[1.7] text-text-secondary">
            {digest.count}件を掲載
            {digest.generatedAt ? ` / 最終更新 ${formatTime(digest.generatedAt)}` : ''}
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium tracking-[0.06em] text-text-secondary">日付</span>
          <span className="relative inline-flex">
            <select
              value={digest.date}
              onChange={(event) => router.push(`/d/${event.target.value}/`)}
              className="h-11 w-full appearance-none rounded-[4px] border border-border bg-surface py-2 pl-3 pr-9 text-[14px] text-text-primary sm:h-9 sm:w-auto"
            >
              {dates.map((entry) => (
                <option key={entry.date} value={entry.date}>
                  {formatDateLabel(entry.date)}（{entry.count}件）
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          </span>
        </label>
      </div>

      <nav aria-label="カテゴリで絞り込む" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip) => {
            const isActive = chip === active;
            const count = chip === 'すべて' ? digest.articles.length : (counts.get(chip) ?? 0);
            return (
              <li key={chip}>
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setActive(chip)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors duration-150 ${
                    isActive
                      ? 'border-primary bg-primary text-white'
                      : 'border-border bg-surface text-text-body hover:text-text-primary'
                  }`}
                >
                  {chip}
                  <span className={`tabular text-[11px] ${isActive ? 'text-white/80' : 'text-text-secondary'}`}>
                    {count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {sections.length === 0 ? (
        <p className="mt-8 rounded-[6px] border border-border bg-surface p-6 text-[14px] leading-[1.8] text-text-secondary">
          このカテゴリの記事はありません。
        </p>
      ) : (
        <div className="mt-8 flex flex-col gap-12">
          {sections.map((section) => (
            <section key={section.category} aria-labelledby={`cat-${section.category}`}>
              <h3
                id={`cat-${section.category}`}
                className="mb-4 flex items-baseline gap-2 border-b border-border pb-2 text-[20px] font-semibold leading-[1.5] text-text-primary"
              >
                {section.category}
                <span className="tabular text-[12px] font-normal text-text-secondary">
                  {section.articles.length}件
                </span>
              </h3>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {section.articles.map((article) => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
