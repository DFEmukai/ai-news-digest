import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isUsableTitle } from './fetch.ts';
import type { DigestFile, IndexFile } from './types.ts';

/**
 * 既存の日次JSONを、いまの収集基準で検証し直す。
 *
 * `build-data.ts` は当日分のファイルしか書かない。そのため収集側の判定を直しても、
 * 過去日のファイルに混入した不正データは二度と検証されず残り続ける。
 * 実際、見出しが欠落した記事（title="- Anthropic"）を除外する修正を入れたあとも、
 * 2026-08-29 のダイジェストには残ったまま公開されていた。
 *
 * 収集側の判定を変えたときに、この補修を1回流す運用にする。
 *
 *   npx tsx scripts/repair-data.ts            # 検出のみ（書き込まない）
 *   npx tsx scripts/repair-data.ts --write    # 実際に修正する
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const ARTICLES_DIR = path.join(DATA_DIR, 'articles');

async function main(): Promise<void> {
  const write = process.argv.slice(2).includes('--write');
  const files = (await readdir(ARTICLES_DIR))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  let totalRemoved = 0;
  let changedFiles = 0;

  for (const file of files) {
    const filePath = path.join(ARTICLES_DIR, file);
    const digest = JSON.parse(await readFile(filePath, 'utf8')) as DigestFile;
    const before = digest.articles ?? [];

    const kept = before.filter((article) => {
      if (isUsableTitle(article.title, article.title)) return true;
      console.log(`[repair] ${file}: 除去 ${JSON.stringify(article.title)} (${article.source})`);
      return false;
    });

    const removed = before.length - kept.length;
    if (removed === 0) continue;

    totalRemoved += removed;
    changedFiles++;

    if (!write) continue;

    digest.articles = kept;
    digest.count = kept.length;
    if (digest.stats) {
      digest.stats.published = kept.length;
      digest.stats.summaryFailures = kept.filter((a) => a.summaryFailed).length;
    }
    await writeFile(filePath, `${JSON.stringify(digest, null, 2)}\n`, 'utf8');
    console.log(`[repair] ${file}: ${before.length}件 → ${kept.length}件 で書き直した`);
  }

  if (totalRemoved === 0) {
    console.log('[repair] 除去対象なし。全ファイルが現在の基準を満たしている。');
    return;
  }

  if (!write) {
    console.log(`[repair] ${changedFiles}ファイルに計${totalRemoved}件の除去対象。--write で実行する。`);
    return;
  }

  // count が変わったので index.json を作り直す
  const indexPath = path.join(DATA_DIR, 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8')) as IndexFile;
  for (const entry of index.dates) {
    try {
      const digest = JSON.parse(
        await readFile(path.join(ARTICLES_DIR, `${entry.date}.json`), 'utf8'),
      ) as DigestFile;
      entry.count = digest.count;
    } catch {
      /* ファイルが無い日はそのまま */
    }
  }
  index.updatedAt = new Date().toISOString();
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`[repair] index.json を更新。計${totalRemoved}件を除去した。`);
}

main().catch((error) => {
  console.error('[repair] 失敗:', error);
  process.exitCode = 1;
});
