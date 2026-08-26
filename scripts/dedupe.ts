import type { RawArticle } from './types.ts';

const TRACKING_PARAM = /^(utm_|ref_|mc_|pk_|fbclid$|gclid$|igshid$|mkt_tok$|spm$|cmpid$|ncid$|at_|_hs|hsa_|oc$|guccounter$|guce_)/i;

/**
 * URL 正規化。トラッキングクエリ・末尾スラッシュ・ホスト表記のゆれを吸収する。
 * 正規化できない文字列はそのまま返す（判定不能なら別記事として残す側に倒す）。
 */
export function normalizeUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    const query = url.searchParams.toString();
    return `${url.hostname}${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return input.trim();
  }
}

/** タイトル正規化。記号・空白・大文字小文字・全角半角のゆれを落とす。 */
export function normalizeTitle(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Jaro 類似度。 */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

/** Jaro-Winkler 類似度（共通接頭辞を最大4文字まで加点）。 */
export function jaroWinkler(a: string, b: string, scalingFactor = 0.1): number {
  const base = jaro(a, b);
  if (base === 0) return 0;
  let prefix = 0;
  const max = Math.min(4, a.length, b.length);
  while (prefix < max && a[prefix] === b[prefix]) prefix++;
  return base + prefix * scalingFactor * (1 - base);
}

export const TITLE_SIMILARITY_THRESHOLD = 0.85;

/** 類似度判定の役に立たない機能語。 */
const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','at','for','with','by','from','as','is','are',
  'was','were','be','been','it','its','this','that','these','those','you','your','we','our','they',
  'their','has','have','had','will','can','not','new','says','said','how','why','what','more','than',
  'up','out','over','into','after','before','about','now','all','其','の','を','に','は','が','と',
]);

function contentTokens(normalizedTitle: string): string[] {
  return normalizedTitle.split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Jaro-Winkler は本来「人名のような短い文字列」向けで、長い見出しでは共通接頭辞の加点により
 * 別記事どうしが 0.85 を超える。実測（2026-08-26 の収集分）:
 *   同一記事 "OpenAI's Jalapeño chip is built for…" ⇔ "OpenAI says its Jalapeño chip can…"      = 0.8592
 *   別記事   "OpenAI loses a top data center exec…" ⇔ "OpenAI says its Jalapeño chip can…"      = 0.8535
 * 差は 0.006 しかなく、JW 単独では分離できない。誤って別記事を消す方が実害が大きいので、
 * JW >= 0.85 に加えて「内容語の重なり」を必須条件にし、仕様より保守的（消しすぎない）側に倒す。
 * 分かち書きされない日本語見出しは内容語に分解できないため、この追加条件は適用しない。
 */
export function looksLikeSameStory(normA: string, normB: string, threshold: number): boolean {
  if (jaroWinkler(normA, normB) < threshold) return false;

  const a = contentTokens(normA);
  const b = contentTokens(normB);
  // トークン数が少ない = 日本語などの非分かち書き。JW の結果をそのまま使う。
  if (a.length < 3 || b.length < 3) return true;

  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t));
  const union = new Set([...a, ...b]).size;
  const jaccard = union === 0 ? 0 : shared.length / union;
  return shared.length >= 2 && jaccard >= 0.15;
}

/** 同点時の勝者を決める。weight 降順 → 公開時刻昇順（先に出した方）→ URL 昇順で安定化。 */
function preferred(a: RawArticle, b: RawArticle): RawArticle {
  if (a.sourceWeight !== b.sourceWeight) return a.sourceWeight > b.sourceWeight ? a : b;
  const ta = Date.parse(a.publishedAt);
  const tb = Date.parse(b.publishedAt);
  if (ta !== tb) return ta < tb ? a : b;
  return a.url <= b.url ? a : b;
}

export interface DedupeResult {
  articles: RawArticle[];
  removedByUrl: number;
  removedByTitle: number;
}

/**
 * ① URL 正規化での完全一致除去 → ② タイトル正規化 + Jaro-Winkler >= 0.85 での近似重複除去。
 * どちらも weight が高いソースを残す。
 *
 * 消した件数は呼び出し側で DigestFile.stats に残すこと。
 * 「消しすぎる誤り = 実在するニュースが黙って消える」ため、事後に検証できる記録が要る。
 */
export function dedupe(input: RawArticle[], threshold = TITLE_SIMILARITY_THRESHOLD): DedupeResult {
  // ① URL 完全一致
  const byUrl = new Map<string, RawArticle>();
  for (const article of input) {
    const key = normalizeUrl(article.url);
    const existing = byUrl.get(key);
    byUrl.set(key, existing ? preferred(existing, article) : article);
  }
  const urlUnique = [...byUrl.values()];
  const removedByUrl = input.length - urlUnique.length;

  // ② タイトル近似一致。weight 降順で走査し、先に採用した記事を代表として残す。
  const ordered = [...urlUnique].sort((a, b) => {
    if (a.sourceWeight !== b.sourceWeight) return b.sourceWeight - a.sourceWeight;
    return Date.parse(a.publishedAt) - Date.parse(b.publishedAt);
  });

  const kept: { article: RawArticle; normTitle: string }[] = [];
  for (const article of ordered) {
    const normTitle = normalizeTitle(article.title);
    if (!normTitle) {
      kept.push({ article, normTitle });
      continue;
    }
    const duplicate = kept.find((k) => k.normTitle && looksLikeSameStory(normTitle, k.normTitle, threshold));
    if (duplicate) {
      console.log(
        `[dedupe] 重複: "${article.title}" (${article.source}) → "${duplicate.article.title}" (${duplicate.article.source}) を採用`,
      );
      continue;
    }
    kept.push({ article, normTitle });
  }

  return {
    articles: kept.map((k) => k.article),
    removedByUrl,
    removedByTitle: urlUnique.length - kept.length,
  };
}
