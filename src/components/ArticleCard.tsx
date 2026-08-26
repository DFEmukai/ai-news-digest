import type { Article } from '@/lib/types';
import { formatTime, importanceLabel, importanceTone } from '@/lib/format';
import { ExternalLinkIcon } from './Icons';

const TONE_CLASS: Record<string, string> = {
  danger: 'bg-badge-danger-bg text-badge-danger-fg',
  warn: 'bg-badge-warn-bg text-badge-warn-fg',
  info: 'bg-badge-info-bg text-badge-info-fg',
  muted: 'bg-badge-muted-bg text-badge-muted-fg',
};

export default function ArticleCard({ article }: { article: Article }) {
  const tone = importanceTone(article.importance);

  return (
    <article className="flex flex-col gap-4 rounded-[6px] border border-border bg-surface p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-shadow duration-150 hover:shadow-[0_4px_12px_rgba(0,0,0,0.12)] sm:p-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[12px] font-medium ${TONE_CLASS[tone]}`}
            title={`重要度 ${article.importance} / 5 — ${importanceLabel(article.importance)}`}
          >
            <span className="tabular">重要度 {article.importance}</span>
            <span className="text-[11px] opacity-80">{importanceLabel(article.importance)}</span>
          </span>
          {article.summaryFailed ? (
            <span
              className="inline-flex items-center rounded-[3px] bg-badge-muted-bg px-1.5 py-0.5 text-[11px] text-badge-muted-fg"
              title="要約の生成に失敗したため、配信元の概要をそのまま表示しています"
            >
              要約なし（配信元の概要）
            </span>
          ) : null}
        </div>

        <h3 className="jp-text text-[16px] font-semibold leading-[1.6] text-text-primary sm:text-[20px] sm:leading-[1.5]">
          {article.title}
        </h3>
      </header>

      <p className="jp-body text-[14px] leading-[1.8] text-text-body">{article.summary}</p>

      {article.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="タグ">
          {article.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-[3px] bg-background-alt px-1.5 py-0.5 text-[11px] text-text-secondary"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* 出典名は必ず明記する */}
          <span className="truncate text-[12px] font-medium tracking-[0.06em] text-text-primary">
            出典: {article.source}
          </span>
          <time
            dateTime={article.publishedAt}
            className="tabular text-[11px] leading-[1.6] text-text-secondary"
          >
            {formatTime(article.publishedAt)} 公開
          </time>
        </div>

        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[4px] bg-primary px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-primary-hover sm:h-9"
        >
          出典を読む
          <ExternalLinkIcon className="h-3.5 w-3.5" />
        </a>
      </footer>
    </article>
  );
}
