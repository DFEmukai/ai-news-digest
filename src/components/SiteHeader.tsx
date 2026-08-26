import Link from 'next/link';
import { ArchiveIcon } from './Icons';
import ThemeToggle from './ThemeToggle';

export default function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-[960px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 flex-col">
          <span className="truncate text-[16px] font-bold leading-[1.4] tracking-[-0.01em] text-text-primary sm:text-[20px]">
            AI News Digest
          </span>
          <span className="truncate text-[11px] leading-[1.6] text-text-secondary">
            国内外のAIニュースを1日2回まとめて日本語で
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/archive/"
            className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-border bg-surface px-3 text-[13px] text-text-body transition-colors duration-150 hover:text-text-primary"
          >
            <ArchiveIcon className="h-4 w-4" />
            <span className="hidden sm:inline">アーカイブ</span>
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
