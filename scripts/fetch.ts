import Parser from 'rss-parser';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Category, RawArticle, Source, SourceStat } from './types.ts';
import { CATEGORIES } from './types.ts';
import { normalizeUrl } from './dedupe.ts';

const SOURCE_TIMEOUT_MS = 10_000;
const WINDOW_HOURS = Number(process.env.WINDOW_HOURS ?? 36);
const USER_AGENT =
  'ai-news-digest/1.0 (+https://github.com/; RSS aggregator; contact via repository)';

export interface FetchResult {
  articles: RawArticle[];
  failed: { name: string; error: string }[];
  /** ソース別の結果。「HTTPは成功したが0件」を後から検出するために必ず全ソース分入れる。 */
  stats: SourceStat[];
}

const parser = new Parser({
  timeout: SOURCE_TIMEOUT_MS,
  headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
  customFields: { item: [['content:encoded', 'contentEncoded']] },
});

/**
 * 記事の一意キー。正規化後の URL から作る。
 * 生URLで作ると utm パラメータが変わっただけで別記事になり、
 * 朝と夜の実行をマージするときに同じ記事が2枚並ぶ。
 */
export function makeId(url: string): string {
  return createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 12);
}

/** http/https 以外（javascript: や data: など）は記事として扱わない。 */
export function isSafeHttpUrl(input: string): boolean {
  try {
    const protocol = new URL(input.trim()).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** HTMLタグ・エンティティを落として1行のプレーンテキストにする。全文は保持せず先頭のみ。 */
export function toPlainText(input: unknown, maxLen = 400): string {
  if (typeof input !== 'string') return '';
  const text = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

/**
 * Google News RSS はタイトル末尾に " - <媒体名>" を足すので落とす。
 *
 * この処理を全ソースに掛けてはいけない。The Verge や Ars Technica の
 * "… — now what?" のような見出しは末尾がダッシュ区切りに見えるため、
 * 正当な見出しの一部を削ってしまう（削った結果が要約の入力にも重複判定にも使われる）。
 * 適用するのは suffix を実際に付けてくる Google News のフィードだけにする。
 */
export function cleanTitle(title: string, stripSourceSuffix: boolean): string {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (!stripSourceSuffix) return normalized;
  return normalized.replace(/\s+[-–—]\s+[^-–—]{1,40}$/u, '').trim();
}

/** Google News RSS 経由かどうか。タイトル末尾の媒体名を落とすかの判定に使う。 */
function isGoogleNewsFeed(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('news.google.com');
  } catch {
    return false;
  }
}

function isFresh(iso: string, now: number): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  // 未来日付（feed 側のタイムゾーン事故）は 6 時間まで許容する
  if (t > now + 6 * 3600_000) return false;
  return now - t <= WINDOW_HOURS * 3600_000;
}

function normalizeCategory(value: string | undefined, fallback: Category): Category {
  return (CATEGORIES as readonly string[]).includes(value ?? '') ? (value as Category) : fallback;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

interface SourceOutcome {
  articles: RawArticle[];
  /** フィードに入っていた総件数（時間フィルタ前）。0 なら配信元が空を返している。 */
  itemsInFeed: number;
}

async function fetchRss(source: Source, now: number): Promise<SourceOutcome> {
  const feed = await withTimeout(parser.parseURL(source.url), SOURCE_TIMEOUT_MS + 2_000, source.name);
  const items = feed.items ?? [];
  const stripSuffix = isGoogleNewsFeed(source.url);
  const out: RawArticle[] = [];

  for (const item of items) {
    const url = (item.link ?? '').trim();
    const title = cleanTitle(toPlainText(item.title ?? '', 300), stripSuffix);
    if (!url || !title || !isSafeHttpUrl(url)) continue;
    const publishedAt = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : '');
    if (!publishedAt || !isFresh(publishedAt, now)) continue;
    out.push({
      id: makeId(url),
      title,
      url,
      source: source.name,
      sourceWeight: source.weight,
      sourceCategory: normalizeCategory(source.category, 'その他'),
      lang: source.lang,
      publishedAt: new Date(publishedAt).toISOString(),
      description: toPlainText(item.contentSnippet ?? item.summary ?? item.content ?? item.contentEncoded ?? ''),
    });
  }
  return { articles: out, itemsInFeed: items.length };
}

/** arXiv Atom API。rss-parser でも読めるが published を確実に取るため自前でパースする。 */
async function fetchArxiv(source: Source, now: number): Promise<SourceOutcome> {
  const xml = await withTimeout(fetchText(source.url), SOURCE_TIMEOUT_MS + 2_000, source.name);
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  const out: RawArticle[] = [];
  for (const entry of entries) {
    const title = toPlainText(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '', 300);
    const rawUrl = (entry.match(/<link[^>]+rel="alternate"[^>]*href="([^"]+)"/)?.[1] ??
      entry.match(/<id>([\s\S]*?)<\/id>/)?.[1] ??
      '').trim();
    const url = rawUrl.replace(/^http:/, 'https:');
    const publishedAt = (entry.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? '').trim();
    if (!title || !url || !isSafeHttpUrl(url) || !publishedAt || !isFresh(publishedAt, now)) continue;
    out.push({
      id: makeId(url),
      title,
      url,
      source: source.name,
      sourceWeight: source.weight,
      sourceCategory: normalizeCategory(source.category, 'モデル/研究'),
      lang: source.lang,
      publishedAt: new Date(publishedAt).toISOString(),
      description: toPlainText(entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? ''),
    });
  }
  return { articles: out, itemsInFeed: entries.length };
}

const HN_AI_PATTERN =
  /\b(ai|a\.i\.|llm|llms|gpt|chatgpt|claude|anthropic|openai|gemini|deepmind|llama|mistral|diffusion|transformer|neural|machine learning|deep learning|agents?|rag|inference|fine.?tun|embedding|hugging ?face|nvidia|copilot|prompt)\b/i;

interface HnHit {
  objectID: string;
  title?: string;
  url?: string | null;
  points?: number;
  created_at?: string;
  story_text?: string | null;
}

/** Hacker News (Algolia)。AI 関連かつ points >= minPoints のみ拾う。 */
async function fetchHackerNews(source: Source, now: number): Promise<SourceOutcome> {
  const data = (await withTimeout(fetchJson(source.url), SOURCE_TIMEOUT_MS + 2_000, source.name)) as {
    hits?: HnHit[];
  };
  const hits = data.hits ?? [];
  const minPoints = source.minPoints ?? 100;
  const out: RawArticle[] = [];
  for (const hit of hits) {
    const title = toPlainText(hit.title ?? '', 300);
    const points = hit.points ?? 0;
    if (!title || points < minPoints) continue;
    if (!HN_AI_PATTERN.test(title)) continue;
    const publishedAt = hit.created_at ?? '';
    if (!publishedAt || !isFresh(publishedAt, now)) continue;
    const url = (hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`).trim();
    if (!isSafeHttpUrl(url)) continue;
    out.push({
      id: makeId(url),
      title,
      url,
      source: source.name,
      sourceWeight: source.weight,
      sourceCategory: normalizeCategory(source.category, 'その他'),
      lang: source.lang,
      publishedAt: new Date(publishedAt).toISOString(),
      description: toPlainText(hit.story_text ?? `Hacker News で ${points} ポイント獲得。`),
    });
  }
  return { articles: out, itemsInFeed: hits.length };
}

export async function loadSources(configPath?: string): Promise<Source[]> {
  const file = configPath ?? path.join(process.cwd(), 'config', 'sources.json');
  const sources = JSON.parse(await readFile(file, 'utf8')) as Source[];
  return sources.filter((s) => s.enabled !== false);
}

/**
 * 全ソースを並列に取得する。1ソースが落ちても全体は止めず failed に記録して続行する。
 *
 * 「HTTP は 200 なのに中身が空」は例外にならないので、failed だけを見ていると
 * 配信元が静かに壊れたことに気づけない。ソース別の件数を必ず stats に残す。
 */
export async function fetchAll(sources: Source[], now = Date.now()): Promise<FetchResult> {
  const results = await Promise.all(
    sources.map(async (source): Promise<{ stat: SourceStat; articles: RawArticle[] }> => {
      const started = Date.now();
      try {
        const outcome =
          source.type === 'arxiv'
            ? await fetchArxiv(source, now)
            : source.type === 'hn-algolia'
              ? await fetchHackerNews(source, now)
              : await fetchRss(source, now);

        const stat: SourceStat = {
          name: source.name,
          weight: source.weight,
          itemsInFeed: outcome.itemsInFeed,
          fetched: outcome.articles.length,
          ok: true,
          durationMs: Date.now() - started,
        };

        if (outcome.itemsInFeed === 0) {
          // 200 は返ったがフィードが空。配信元の不調か URL の陳腐化を疑う。
          console.warn(
            `[fetch] EMPTY ${source.name}: フィードに1件も入っていない（配信停止/URL陳腐化の疑い） (${stat.durationMs}ms)`,
          );
        } else if (outcome.articles.length === 0) {
          console.log(
            `[fetch] ok    ${source.name}: 0件（フィードには${outcome.itemsInFeed}件あるが${WINDOW_HOURS}時間以内の新着なし） (${stat.durationMs}ms)`,
          );
        } else {
          console.log(
            `[fetch] ok    ${source.name}: ${outcome.articles.length}件 / フィード${outcome.itemsInFeed}件 (${stat.durationMs}ms)`,
          );
        }
        return { stat, articles: outcome.articles };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const durationMs = Date.now() - started;
        console.warn(`[fetch] FAIL  ${source.name}: ${message} (${durationMs}ms)`);
        return {
          stat: {
            name: source.name,
            weight: source.weight,
            itemsInFeed: 0,
            fetched: 0,
            ok: false,
            error: message,
            durationMs,
          },
          articles: [],
        };
      }
    }),
  );

  const stats = results.map((r) => r.stat);
  const empty = stats.filter((s) => s.ok && s.itemsInFeed === 0).map((s) => s.name);
  if (empty.length > 0) {
    console.warn(`[fetch] 空のフィード ${empty.length}件: ${empty.join(', ')}`);
  }

  return {
    articles: results.flatMap((r) => r.articles),
    failed: stats
      .filter((s) => !s.ok)
      .map((s) => ({ name: s.name, error: s.error ?? 'unknown error' })),
    stats,
  };
}
