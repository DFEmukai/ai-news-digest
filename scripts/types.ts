export const CATEGORIES = [
  'モデル/研究',
  'プロダクト',
  'ビジネス/資金調達',
  '規制/政策',
  '開発ツール',
  'その他',
] as const;

export type Category = (typeof CATEGORIES)[number];

export type SourceType = 'rss' | 'arxiv' | 'hn-algolia';

export interface Source {
  name: string;
  url: string;
  category: Category;
  lang: string;
  /** 重複時にどちらを残すかの優先度。大きいほど優先。 */
  weight: number;
  type?: SourceType;
  minPoints?: number;
  note?: string;
  enabled?: boolean;
}

/** 収集時点の記事。本文は保持しない（title / url / source / publishedAt / description のみ）。 */
export interface RawArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceWeight: number;
  sourceCategory: Category;
  lang: string;
  publishedAt: string; // ISO8601
  description: string;
}

/** 要約後の記事。 */
export interface Article extends RawArticle {
  summary: string;
  category: Category;
  tags: string[];
  importance: number; // 1-5
  /** 要約に失敗し description を流用した場合 true */
  summaryFailed?: boolean;
}

/** ソース1件ぶんの収集結果。0件だったことを後から検出できるように必ず全ソース分残す。 */
export interface SourceStat {
  name: string;
  weight: number;
  /** フィードに入っていた総件数（時間フィルタ前）。0 なら配信元が空を返している。 */
  itemsInFeed: number;
  /** 時間フィルタ通過後の件数 */
  fetched: number;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface DigestFile {
  date: string; // YYYY-MM-DD (JST)
  generatedAt: string; // ISO8601
  count: number;
  /** 収集〜要約の過程で落ちたソースなどの記録 */
  stats: {
    fetched: number;
    afterDedupe: number;
    published: number;
    removedByUrl: number;
    removedByTitle: number;
    failedSources: { name: string; error: string }[];
    /** HTTP は成功したがフィードが空だったソース */
    emptySources: string[];
    /** 最終的な掲載30件に1件も載らなかったソース */
    absentFromDigest: string[];
    summarized: number;
    summaryFailures: number;
    /** ソース別の内訳。連続0件の検出に使う。 */
    sources: SourceStat[];
  };
  articles: Article[];
  /**
   * 事後に補修した記録（scripts/repair-data.ts）。
   * 掲載件数が当日の実行結果と食い違う理由を、git 履歴ではなくデータ自体に残す。
   */
  repairs?: {
    at: string;
    reason: 'broken-title' | 'duplicate-id';
    removed: number;
    before: number;
    after: number;
    /** 補修前の stats の値（補修で上書きするため、元の記録をここに退避する） */
    originalPublished: number;
    originalSummaryFailures: number;
  }[];
}

export interface IndexEntry {
  date: string;
  count: number;
  generatedAt: string;
}

export interface IndexFile {
  updatedAt: string;
  /** 最後に収集を試みた時刻。0件でスキップした場合もここは更新される。 */
  lastAttemptedAt?: string;
  dates: IndexEntry[];
}
