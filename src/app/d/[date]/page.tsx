import { notFound } from 'next/navigation';
import DigestBrowser from '@/components/DigestBrowser';
import { getDigest, getIndex } from '@/lib/data';
import { formatDateLabel } from '@/lib/format';

export async function generateStaticParams() {
  const dates = await getIndex();
  return dates.map((entry) => ({ date: entry.date }));
}

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return { title: `${formatDateLabel(date)} のダイジェスト` };
}

export default async function DatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const [digest, dates] = await Promise.all([getDigest(date), getIndex()]);
  if (!digest) notFound();

  return <DigestBrowser digest={digest} dates={dates} />;
}
