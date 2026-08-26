import DigestBrowser from '@/components/DigestBrowser';
import { getIndex, getLatestDigest } from '@/lib/data';

export default async function HomePage() {
  const [digest, dates] = await Promise.all([getLatestDigest(), getIndex()]);

  if (!digest) {
    return (
      <div className="rounded-[6px] border border-border bg-surface p-6">
        <h2 className="mb-2 text-[20px] font-semibold leading-[1.5] text-text-primary">
          まだダイジェストがありません
        </h2>
        <p className="jp-text text-[14px] leading-[1.8] text-text-body">
          <code className="rounded-[3px] bg-background-alt px-1.5 py-0.5">npm run collect</code>{' '}
          を実行すると <code className="rounded-[3px] bg-background-alt px-1.5 py-0.5">data/articles/</code>{' '}
          に当日分の JSON が生成されます。
        </p>
      </div>
    );
  }

  return <DigestBrowser digest={digest} dates={dates} />;
}
