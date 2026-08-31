import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Article, DigestFile, IndexEntry, IndexFile } from './types.ts';

/**
 * 既存の日次JSONに残った不正データを取り除き、件数の整合を取り直す。
 *
 * なぜ要るか: `build-data.ts` は当日分のファイルしか書かない。そのため収集側の判定を
 * 直しても、過去日のファイルに混入した不正データは二度と検証されず残り続ける。
 * 実際、見出しが欠落した記事（title="- Anthropic"）を除外する修正を入れたあとも、
 * 2026-08-29 のダイジェストには残ったまま公開されていた。
 *
 *   npx tsx scripts/repair-data.ts            # 検出のみ。違反があっても終了コードは0
 *   npx tsx scripts/repair-data.ts --check    # 検出のみ。違反があれば終了コード1（CIの門用）
 *   npx tsx scripts/repair-data.ts --write    # 実際に修正する
 *
 * **CI の `Validate data before build` は `--check` を呼んでいる。**
 * 終了コードの意味を変えると門が静かに壊れるので注意すること。
 *
 * ## このスクリプトが検査できること・できないこと
 *
 * 検査するのは「保存済みデータだけで判定できる不変条件」に限る。
 *
 *   1. title が空、または区切り文字で始まる（= 見出しが欠落した記事）
 *   2. 同一ファイル内での id の重複
 *   3. count / stats.published と articles の実件数のずれ
 *   4. index.json と data/articles/ のファイル集合・件数のずれ
 *
 * **収集側（fetch.ts）の判定をそのまま再現することはできない。**
 * `isUsableTitle` は「整形前の生タイトル」を見て判定するが、`cleanTitle` が先頭の
 * 区切り文字を落としてから保存するため、保存済みの title には判定材料が残っていない。
 * したがって条件1が拾えるのは、先頭区切り除去を入れる前（コミット 6cab4f4 以前）に
 * 書かれた古いデータだけである。
 *
 * 「除去対象なし」は **1〜4 を満たしている**という意味であって、
 * 「現在の収集基準を満たしている」という意味ではない。
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const ARTICLES_DIR = path.join(DATA_DIR, 'articles');

const SEPARATOR_START = /^\s*[-–—|·•]/u;

/** 保存済みの title だけで判定できる「見出しとして成立していない」条件。 */
function isBrokenStoredTitle(title: string): boolean {
  return title.trim().length === 0 || SEPARATOR_START.test(title);
}

interface FileReport {
  file: string;
  date: string;
  digest: DigestFile;
  kept: Article[];
  removedTitles: string[];
  duplicateIds: string[];
  countMismatch: boolean;
}

async function inspect(file: string): Promise<FileReport> {
  const digest = JSON.parse(await readFile(path.join(ARTICLES_DIR, file), 'utf8')) as DigestFile;
  const articles = digest.articles ?? [];

  const removedTitles: string[] = [];
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  const kept: Article[] = [];

  for (const article of articles) {
    if (isBrokenStoredTitle(article.title)) {
      removedTitles.push(article.title);
      continue;
    }
    if (seen.has(article.id)) {
      duplicateIds.push(article.id);
      continue;
    }
    seen.add(article.id);
    kept.push(article);
  }

  return {
    file,
    date: digest.date ?? file.replace('.json', ''),
    digest,
    kept,
    removedTitles,
    duplicateIds,
    // stats を持たない古い形式のファイルでも冪等になるよう、stats はある場合だけ見る
    countMismatch:
      digest.count !== articles.length ||
      (digest.stats !== undefined && digest.stats.published !== articles.length),
  };
}

/** index.json を data/articles/ の実体から作り直す（build-data.ts の rebuildIndex と同じ方針）。 */
function buildIndexFrom(reports: FileReport[], previous: IndexFile): IndexFile {
  const dates: IndexEntry[] = reports
    .map((r) => ({
      date: r.date,
      count: r.kept.length,
      generatedAt: r.digest.generatedAt ?? '',
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return { updatedAt: new Date().toISOString(), lastAttemptedAt: previous.lastAttemptedAt, dates };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const check = argv.includes('--check');

  const files = (await readdir(ARTICLES_DIR))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  // 途中で失敗して一部だけ書き換わるのを避けるため、全件読んで検証してから書き出す
  const reports: FileReport[] = [];
  for (const file of files) reports.push(await inspect(file));

  // index.json のパース失敗を握り潰してはいけない。
  // 2026-08-30 の障害で壊れたのはこのファイルで、getIndex() が catch に落ちた結果、
  // 全日付の件数が 0 のサイトが公開された。
  // ファイルが無いのは初回なので許すが、「あるのに読めない」は破損なので落とす。
  let indexPrev: IndexFile = { updatedAt: '', dates: [] };
  let indexRaw: string | null = null;
  try {
    indexRaw = await readFile(path.join(DATA_DIR, 'index.json'), 'utf8');
  } catch {
    console.warn('[repair] index.json が存在しない。実体から作り直す。');
  }
  if (indexRaw !== null) {
    try {
      indexPrev = JSON.parse(indexRaw) as IndexFile;
    } catch (error) {
      console.error(`[repair] index.json が壊れている（パース不能）: ${String(error)}`);
      process.exitCode = 1;
      if (!write) return;
      console.warn('[repair] --write なので実体から作り直す。');
    }
  }

  const nextIndex = buildIndexFrom(reports, indexPrev);
  const indexDates = new Set(indexPrev.dates.map((d) => d.date));
  const fileDates = new Set(reports.map((r) => r.date));
  const dangling = [...indexDates].filter((d) => !fileDates.has(d));
  const missingInIndex = [...fileDates].filter((d) => !indexDates.has(d));
  const countDrift = indexPrev.dates.filter((e) => {
    const r = reports.find((x) => x.date === e.date);
    return r && e.count !== r.kept.length;
  });

  for (const r of reports) {
    for (const title of r.removedTitles) {
      console.log(`[repair] ${r.file}: 見出し欠落を除去 ${JSON.stringify(title)}`);
    }
    for (const id of r.duplicateIds) {
      console.log(`[repair] ${r.file}: id 重複を除去 ${id}`);
    }
    if (r.countMismatch) {
      console.log(
        `[repair] ${r.file}: 件数のずれ count=${r.digest.count} published=${r.digest.stats?.published} 実体=${(r.digest.articles ?? []).length}`,
      );
    }
  }
  // index.json の不整合は、記事の除去が0件でも起こりうるので独立に報告する
  if (dangling.length > 0) {
    // 残すと generateStaticParams が実体の無い日付のページを作ろうとして next build が落ちる
    console.log(`[repair] index.json: 実体の無い日付 ${dangling.join(', ')}`);
  }
  if (missingInIndex.length > 0) {
    console.log(`[repair] index.json: 未登録の日付 ${missingInIndex.join(', ')}`);
  }
  if (countDrift.length > 0) {
    console.log(`[repair] index.json: 件数のずれ ${countDrift.map((e) => e.date).join(', ')}`);
  }

  const removedTotal = reports.reduce((n, r) => n + r.removedTitles.length + r.duplicateIds.length, 0);
  const needsFileWrite = reports.filter((r) => r.removedTitles.length + r.duplicateIds.length > 0 || r.countMismatch);
  const needsIndexWrite = dangling.length > 0 || missingInIndex.length > 0 || countDrift.length > 0;

  if (removedTotal === 0 && needsFileWrite.length === 0 && !needsIndexWrite) {
    console.log(`[repair] ${files.length}ファイルを検査。不変条件1〜4はすべて満たしている。`);
    return;
  }

  if (!write) {
    const message = `[repair] 要修正: ${needsFileWrite.length}ファイル / 除去対象${removedTotal}件${needsIndexWrite ? ' / index.json' : ''}。--write で修正する。`;
    if (check) {
      console.error(message);
      process.exitCode = 1;
    } else {
      console.log(message);
    }
    return;
  }

  for (const r of needsFileWrite) {
    const before = (r.digest.articles ?? []).length;
    const removed = r.removedTitles.length + r.duplicateIds.length;

    // 何をどう直したかをデータ自体に残す。
    // git のコミットメッセージにしか理由が無いと、後からデータだけを見た人が
    // 「その日はネタが少なかった」と誤読する。
    if (removed > 0) {
      r.digest.repairs = [
        ...(r.digest.repairs ?? []),
        {
          at: new Date().toISOString(),
          reason: r.removedTitles.length > 0 ? 'broken-title' : 'duplicate-id',
          removed,
          before,
          after: r.kept.length,
          originalPublished: r.digest.stats?.published ?? before,
          originalSummaryFailures: r.digest.stats?.summaryFailures ?? 0,
        },
      ];
    }

    r.digest.articles = r.kept;
    r.digest.count = r.kept.length;
    if (r.digest.stats) {
      r.digest.stats.published = r.kept.length;
      r.digest.stats.summaryFailures = r.kept.filter((a) => a.summaryFailed).length;
    }
    await writeFile(
      path.join(ARTICLES_DIR, r.file),
      `${JSON.stringify(r.digest, null, 2)}\n`,
      'utf8',
    );
    console.log(`[repair] ${r.file}: ${before}件 → ${r.kept.length}件 で書き直した`);
  }

  await writeFile(path.join(DATA_DIR, 'index.json'), `${JSON.stringify(nextIndex, null, 2)}\n`, 'utf8');
  console.log(`[repair] index.json を実体から作り直した（${nextIndex.dates.length}日分）。`);
}

main().catch((error) => {
  console.error('[repair] 失敗:', error);
  process.exitCode = 1;
});
