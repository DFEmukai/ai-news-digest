import Anthropic from '@anthropic-ai/sdk';
import type { Article, Category, RawArticle } from './types.ts';
import { CATEGORIES } from './types.ts';

export const MODEL = 'claude-haiku-4-5-20251001';
export const BATCH_SIZE = 10;

const SYSTEM_PROMPT = `あなたは日本語のAIニュース編集者です。各記事について、
与えられたタイトルと概要のみを根拠に、日本語で要約してください。
原文の言い回しをそのまま写さず、必ず自分の言葉で書き直すこと。
推測で事実を補わないこと。JSONのみを返し、前置きやコードフェンスは付けないこと。`;

const OUTPUT_SPEC = `出力は次の形の JSON 配列のみ。入力と同じ件数・同じ id を返すこと。
[
  {
    "id": "入力の id をそのまま",
    "summary": "日本語120字前後・3文以内の要約",
    "category": ${CATEGORIES.map((c) => `"${c}"`).join(' | ')},
    "tags": ["最大3個の短い日本語または英語のタグ"],
    "importance": 1
  }
]
importance は 5=業界全体に影響、1=小ネタ の 1〜5 の整数。
category は上の6つのいずれかから必ず選ぶこと。`;

interface SummaryItem {
  id: string;
  summary: string;
  category: Category;
  tags: string[];
  importance: number;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** モデルが前置きやコードフェンスを付けてしまった場合に備えて JSON 配列部分だけ取り出す。 */
export function extractJsonArray(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('[');
    const end = stripped.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) throw new Error('JSON配列が見つからない');
    return JSON.parse(stripped.slice(start, end + 1));
  }
}

function clampImportance(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, n));
}

function normalizeCategory(value: unknown, fallback: Category): Category {
  return (CATEGORIES as readonly string[]).includes(String(value)) ? (value as Category) : fallback;
}

export function normalizeSummaries(parsed: unknown): Map<string, SummaryItem> {
  if (!Array.isArray(parsed)) throw new Error('JSONのトップレベルが配列でない');
  const map = new Map<string, SummaryItem>();
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '';
    const rawSummary = typeof item.summary === 'string' ? item.summary.trim() : '';
    if (!id || !rawSummary) continue;
    // 要約はそのまま公開サイトに載る。配信元フィードの本文はモデルへの入力なので、
    // 悪質なフィードが長文を出力させて紙面を占拠しないよう長さを切る（120字前後の指示に対する上限）。
    const summary = rawSummary.length > 240 ? `${rawSummary.slice(0, 240)}…` : rawSummary;
    map.set(id, {
      id,
      summary,
      category: normalizeCategory(item.category, 'その他'),
      tags: Array.isArray(item.tags)
        ? item.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').slice(0, 3).map((t) => t.trim())
        : [],
      importance: clampImportance(item.importance),
    });
  }
  if (map.size === 0) throw new Error('有効な要約が1件も含まれていない');
  return map;
}

function buildUserMessage(batch: RawArticle[]): string {
  const payload = batch.map((a) => ({
    id: a.id,
    title: a.title,
    source: a.source,
    description: a.description.slice(0, 600),
  }));
  return `${OUTPUT_SPEC}\n\n入力記事（${batch.length}件）:\n${JSON.stringify(payload, null, 2)}`;
}

/** description を要約の代わりに流用する。要約失敗時のフォールバック。 */
function fallbackArticle(article: RawArticle): Article {
  const text = article.description || article.title;
  return {
    ...article,
    summary: text.length > 160 ? `${text.slice(0, 160)}…` : text,
    category: article.sourceCategory,
    tags: [],
    importance: 3,
    summaryFailed: true,
  };
}

async function summarizeBatch(
  client: Anthropic,
  batch: RawArticle[],
  batchNo: number,
): Promise<Article[]> {
  const attempt = async (): Promise<Map<string, SummaryItem>> => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(batch) }],
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return normalizeSummaries(extractJsonArray(text));
  };

  let summaries: Map<string, SummaryItem> | null = null;
  try {
    summaries = await attempt();
  } catch (error) {
    // JSONパース失敗時は1回だけリトライする
    console.warn(
      `[summarize] batch ${batchNo}: 1回目失敗 (${error instanceof Error ? error.message : String(error)}) → リトライ`,
    );
    try {
      summaries = await attempt();
    } catch (retryError) {
      console.warn(
        `[summarize] batch ${batchNo}: リトライも失敗 (${retryError instanceof Error ? retryError.message : String(retryError)}) → description を流用`,
      );
      return batch.map(fallbackArticle);
    }
  }

  return batch.map((article) => {
    const item = summaries.get(article.id);
    if (!item) {
      console.warn(`[summarize] id=${article.id} の要約が返らなかった → description を流用`);
      return fallbackArticle(article);
    }
    return {
      ...article,
      summary: item.summary,
      category: item.category,
      tags: item.tags,
      importance: item.importance,
    };
  });
}

/**
 * 最大10件ずつまとめて Claude に投げて要約する。
 * バッチ単位で失敗しても全体は止めず、そのバッチだけ description 流用にフォールバックする。
 */
export async function summarizeAll(articles: RawArticle[], apiKey?: string): Promise<Article[]> {
  if (articles.length === 0) return [];

  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.warn('[summarize] ANTHROPIC_API_KEY が無いため要約をスキップし description を流用する');
    return articles.map(fallbackArticle);
  }

  const client = new Anthropic({ apiKey: key, maxRetries: 3 });
  const batches = chunk(articles, BATCH_SIZE);
  const out: Article[] = [];

  for (const [index, batch] of batches.entries()) {
    const batchNo = index + 1;
    console.log(`[summarize] batch ${batchNo}/${batches.length} (${batch.length}件) …`);
    try {
      out.push(...(await summarizeBatch(client, batch, batchNo)));
    } catch (error) {
      console.warn(
        `[summarize] batch ${batchNo}: API 呼び出しに失敗 (${error instanceof Error ? error.message : String(error)}) → description を流用`,
      );
      out.push(...batch.map(fallbackArticle));
    }
  }

  const failures = out.filter((a) => a.summaryFailed).length;
  console.log(`[summarize] 完了: ${out.length}件 (要約失敗 ${failures}件)`);
  return out;
}
