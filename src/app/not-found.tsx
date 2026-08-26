import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="rounded-[6px] border border-border bg-surface p-6">
      <h2 className="mb-2 text-[20px] font-semibold leading-[1.5] text-text-primary">
        ページが見つかりません
      </h2>
      <p className="jp-text mb-4 text-[14px] leading-[1.8] text-text-body">
        指定された日付のダイジェストは存在しません。
      </p>
      <Link href="/" className="text-[14px] text-primary hover:underline">
        最新のダイジェストへ
      </Link>
    </div>
  );
}
