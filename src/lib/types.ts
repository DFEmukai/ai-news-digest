// クライアントコンポーネントからも読む型・定数。fs に触れないこと（webpack が node: を解決できない）。
export type { Article, Category, DigestFile, IndexEntry, IndexFile } from '../../scripts/types.ts';
export { CATEGORIES } from '../../scripts/types.ts';
