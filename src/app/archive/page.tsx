import Link from 'next/link';
import { getIndex } from '@/lib/data';
import { formatDateLabel } from '@/lib/format';

export const metadata = { title: 'アーカイブ' };

export default async function ArchivePage() {
  const dates = await getIndex();

  return (
    <>
      <h2 className="text-[24px] font-bold leading-[1.4] tracking-[-0.01em] text-text-primary">
        アーカイブ
      </h2>
      <p className="mt-1 tabular text-[13px] leading-[1.7] text-text-secondary">
        {dates.length}日分のダイジェスト
      </p>

      {dates.length === 0 ? (
        <p className="mt-8 rounded-[6px] border border-border bg-surface p-6 text-[14px] leading-[1.8] text-text-secondary">
          まだダイジェストがありません。
        </p>
      ) : (
        <ul className="mt-8 overflow-hidden rounded-[6px] border border-border bg-surface">
          {dates.map((entry, i) => (
            <li key={entry.date} className={i > 0 ? 'border-t border-border' : ''}>
              <Link
                // 最新日も /d/<date>/ を指す。'/' に寄せると生成済みの日付ページが
                // サイト内のどこからもリンクされない孤立ページになる。
                href={`/d/${entry.date}/`}
                className="flex min-h-12 items-center justify-between gap-4 px-4 py-3 transition-colors duration-150 hover:bg-background-alt sm:px-6"
              >
                <span className="text-[14px] leading-[1.8] text-text-primary">
                  {formatDateLabel(entry.date)}
                </span>
                <span className="tabular shrink-0 text-[13px] text-text-secondary">
                  {entry.count}件
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
