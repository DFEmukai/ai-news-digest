import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchAll, isUsableTitle, loadSources } from './fetch.ts';
import { dedupe } from './dedupe.ts';
import { summarizeAll } from './summarize.ts';
import type { Article, DigestFile, IndexFile, RawArticle } from './types.ts';

const MAX_ARTICLES = Number(process.env.MAX_ARTICLES ?? 30);
/**
 * 要約に回す上限。既定は「重複除去後の全件」。
 * 要約対象を weight 順で足切りすると weight が掲載可否のゲートになり、
 * 低 weight ソースの記事が importance によらず構造的に載らなくなる。
 * また importance はバッチ内の相対比較で付くため、weight 順に切り出したバッチでは
 * バッチ間で較正が効かない。コストを抑えたいときだけ明示的に設定する。
 */
const MAX_SUMMARIZE = process.env.MAX_SUMMARIZE ? Number(process.env.MAX_SUMMARIZE) : Infinity;

const DATA_DIR = path.join(process.cwd(), 'data');
const ARTICLES_DIR = path.join(DATA_DIR, 'articles');

/** .env があれば読む。無くても落とさない（CI では secrets が環境変数で入る）。 */
async function loadDotEnv(): Promise<void> {
  try {
    const { config } = await import('dotenv');
    config({ path: path.join(process.cwd(), '.env'), quiet: true });
  } catch {
    /* dotenv が無い環境（本番CI）では何もしない */
  }
}

/** JST の YYYY-MM-DD を返す。 */
export function jstDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** importance 降順 → 公開時刻降順。 */
export function rank(articles: Article[]): Article[] {
  return [...articles].sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance;
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  });
}

async function rebuildIndex(lastAttemptedAt: string): Promise<IndexFile> {
  const files = (await readdir(ARTICLES_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const dates = [];
  for (const file of files) {
    try {
      const digest = JSON.parse(await readFile(path.join(ARTICLES_DIR, file), 'utf8')) as DigestFile;
      dates.push({
        date: digest.date ?? file.replace('.json', ''),
        count: digest.count ?? digest.articles?.length ?? 0,
        generatedAt: digest.generatedAt ?? '',
      });
    } catch (error) {
      console.warn(`[index] ${file} を読めなかったのでスキップ: ${String(error)}`);
    }
  }
  dates.sort((a, b) => b.date.localeCompare(a.date));
  return { updatedAt: new Date().toISOString(), lastAttemptedAt, dates };
}

/**
 * 同じ日に2回走る（07:00 / 19:00 JST）ので、既存ファイルとマージする。
 * id は正規化後 URL のハッシュなので、utm 等が変わっただけの再取得は同一とみなせる。
 *
 * 既存記事も収集時と同じ基準で検証し直す。検証を新規取得分にしか掛けないと、
 * 一度混入した不正データがマージで残り続けて自然に消えない
 * （実際、"- Anthropic" という見出し欠落の記事が公開サイトに残った）。
 */
async function mergeWithExisting(filePath: string, fresh: Article[]): Promise<Article[]> {
  let existing: Article[] = [];
  try {
    const digest = JSON.parse(await readFile(filePath, 'utf8')) as DigestFile;
    existing = digest.articles ?? [];
  } catch {
    return fresh;
  }

  const usable = existing.filter((article) => {
    if (isUsableTitle(article.title, article.title)) return true;
    console.warn(`[build] 既存記事を破棄: 見出しが成立していない ${JSON.stringify(article.title)}`);
    return false;
  });

  const byId = new Map<string, Article>();
  for (const article of usable) byId.set(article.id, article);
  for (const article of fresh) byId.set(article.id, article);
  console.log(`[build] 既存 ${existing.length}件（有効 ${usable.length}件）とマージ → ${byId.size}件`);
  return [...byId.values()];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const noSummary = argv.includes('--no-summary') || dryRun;

  await loadDotEnv();

  const startedAt = new Date();
  const date = jstDate(startedAt);
  console.log(`[build] 対象日(JST): ${date}${dryRun ? ' (dry-run: ファイルは書かない)' : ''}`);

  const sources = await loadSources();
  console.log(`[build] ソース ${sources.length}件を収集する`);

  const { articles: fetched, failed, stats: sourceStats } = await fetchAll(sources);
  console.log(`[build] 収集: ${fetched.length}件 / 失敗ソース: ${failed.length}件`);

  const { articles: deduped, removedByUrl, removedByTitle } = dedupe(fetched);
  console.log(
    `[build] 重複除去: URL一致 -${removedByUrl}件 / タイトル類似 -${removedByTitle}件 → ${deduped.length}件`,
  );

  const candidates: RawArticle[] = Number.isFinite(MAX_SUMMARIZE)
    ? [...deduped]
        .sort((a, b) => {
          if (b.sourceWeight !== a.sourceWeight) return b.sourceWeight - a.sourceWeight;
          return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
        })
        .slice(0, MAX_SUMMARIZE)
    : deduped;
  if (candidates.length < deduped.length) {
    console.warn(
      `[build] MAX_SUMMARIZE=${MAX_SUMMARIZE} により ${deduped.length - candidates.length}件を要約対象から除外した（weight下位が落ちる）`,
    );
  }
  console.log(`[build] 要約対象: ${candidates.length}件`);

  // noSummary のときは空キーを渡し、summarizeAll 側のフォールバック（description 流用）に落とす。
  const summarized = noSummary ? await summarizeAll(candidates, '') : await summarizeAll(candidates);

  const filePath = path.join(ARTICLES_DIR, `${date}.json`);
  const merged = dryRun ? summarized : await mergeWithExisting(filePath, summarized);
  const published = rank(merged).slice(0, MAX_ARTICLES);

  const publishedSources = new Set(published.map((a) => a.source));
  const absentFromDigest = sourceStats.filter((s) => !publishedSources.has(s.name)).map((s) => s.name);
  if (absentFromDigest.length > 0) {
    console.warn(`[build] 掲載0件のソース ${absentFromDigest.length}件: ${absentFromDigest.join(', ')}`);
  }

  const digest: DigestFile = {
    date,
    generatedAt: startedAt.toISOString(),
    count: published.length,
    stats: {
      fetched: fetched.length,
      afterDedupe: deduped.length,
      published: published.length,
      removedByUrl,
      removedByTitle,
      failedSources: failed,
      emptySources: sourceStats.filter((s) => s.ok && s.itemsInFeed === 0).map((s) => s.name),
      absentFromDigest,
      summarized: candidates.length,
      summaryFailures: published.filter((a) => a.summaryFailed).length,
      sources: sourceStats,
    },
    articles: published,
  };

  if (dryRun) {
    console.log(`[build] dry-run 完了: ${published.length}件（書き込みなし）`);
    console.log(JSON.stringify({ ...digest, articles: published.slice(0, 2) }, null, 2));
    return;
  }

  await mkdir(ARTICLES_DIR, { recursive: true });

  if (published.length === 0) {
    // 収集0件でもワークフローは落とさない。既存ファイルを空で上書きしないよう、記事ファイルは書かずに終える。
    // ただし「試みた」記録は index.json に残す（全ソースが死んでも誰も気づかない状態を避ける）。
    console.warn('[build] 公開対象が0件だったため記事ファイルは更新しない');
    const index = await rebuildIndex(startedAt.toISOString());
    await writeFile(path.join(DATA_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    return;
  }

  await writeFile(filePath, `${JSON.stringify(digest, null, 2)}\n`, 'utf8');
  console.log(`[build] 書き出し: ${path.relative(process.cwd(), filePath)} (${published.length}件)`);

  const index = await rebuildIndex(startedAt.toISOString());
  await writeFile(path.join(DATA_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`[build] index.json 更新: ${index.dates.length}日分`);
}

/**
 * undici(グローバル fetch)の keep-alive ソケットがイベントループを掴んだままになり、
 * main() 完了後もプロセスが終了しない（CI が無駄にタイムアウトまで回る）。
 * stdout / stderr の両方を flush してから明示的に終了する
 * （stderr を待たないと、CI で致命的エラーの本文が落ちることがある）。
 */
async function shutdown(code: number): Promise<never> {
  const flush = (stream: NodeJS.WriteStream) =>
    new Promise<void>((resolve) => {
      if (stream.write('')) resolve();
      else stream.once('drain', () => resolve());
    });
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(code);
}

main()
  .then(() => shutdown(0))
  .catch(async (error) => {
    console.error('[build] 致命的エラー:', error);
    await shutdown(1);
  });
