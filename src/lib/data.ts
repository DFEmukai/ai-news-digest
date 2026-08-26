import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DigestFile, IndexEntry, IndexFile } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const ARTICLES_DIR = path.join(DATA_DIR, 'articles');

/** data/index.json を読む。まだ収集していない場合は空を返す（ビルドを落とさない）。 */
export async function getIndex(): Promise<IndexEntry[]> {
  try {
    const index = JSON.parse(await readFile(path.join(DATA_DIR, 'index.json'), 'utf8')) as IndexFile;
    return [...(index.dates ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    // index.json が無い/壊れている場合はディレクトリから組み立てる
    try {
      const files = (await readdir(ARTICLES_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
      return files
        .map((f) => ({ date: f.replace('.json', ''), count: 0, generatedAt: '' }))
        .sort((a, b) => b.date.localeCompare(a.date));
    } catch {
      return [];
    }
  }
}

export async function getDigest(date: string): Promise<DigestFile | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  try {
    return JSON.parse(await readFile(path.join(ARTICLES_DIR, `${date}.json`), 'utf8')) as DigestFile;
  } catch {
    return null;
  }
}

export async function getLatestDigest(): Promise<DigestFile | null> {
  const [latest] = await getIndex();
  return latest ? getDigest(latest.date) : null;
}
