# ai-news-digest

国内外の AI ニュースを 1 日 2 回（07:00 / 19:00 JST）自動で収集し、日本語の要約を付けて
GitHub Pages に静的サイトとして公開する仕組み。データベースは使わず、日次 JSON を
リポジトリにコミットして履歴とする。

- 収集 → 重複除去 → 要約 → JSON 出力 まではすべて `scripts/` の TypeScript
- サイトは Next.js 15 App Router + Tailwind CSS v4、`output: 'export'` の静的書き出し
- 自動実行は GitHub Actions（`.github/workflows/daily.yml`）

---

## 1. 全体の流れ

```
config/sources.json
        │
        ▼
scripts/fetch.ts       RSS / arXiv API / Hacker News API から直近36時間の記事を集める
        │              取るのは title / url / source / publishedAt / description のみ
        ▼              （本文の全文取得・保存はしない — 著作権配慮）
scripts/dedupe.ts      URL正規化での完全一致 → タイトル類似度での近似重複を除去
        │              重複時は weight の高いソースを残す
        ▼
scripts/summarize.ts   Claude Haiku 4.5 に最大10件ずつ渡して日本語要約・分類・重要度付け
        │
        ▼
scripts/build-data.ts  importance降順 → 公開時刻降順 で上位30件を
                       data/articles/YYYY-MM-DD.json に保存し data/index.json を更新
        │
        ▼
src/app/               ビルド時に data/ を読んで静的HTMLを書き出す
```

---

## 2. セットアップ

### 必要なもの

- Node.js 22 以上
- Claude API キー（<https://console.anthropic.com/settings/keys>）

### 手順

```bash
git clone <このリポジトリ>
cd ai-news-digest
npm install

cp .env.example .env
# .env を開いて ANTHROPIC_API_KEY を設定する
```

### 動かす

```bash
# ① まず収集だけ試す（API を呼ばない・ファイルも書かない）
npm run collect:dry

# ② 本番の収集（要約あり・data/ に書き出す）
npm run collect

# ③ サイトを開発モードで見る
npm run dev            # http://localhost:3000

# ④ 静的書き出し（out/ に生成される）
npm run build
```

`npm run collect` を一度も実行していない状態でもサイトはビルドできる
（「まだダイジェストがありません」と表示される）。

### npm scripts

| コマンド | 内容 |
|---|---|
| `npm run collect` | 収集 → 重複除去 → 要約 → `data/` に書き出し |
| `npm run collect:dry` | 収集と重複除去だけ実行。API を呼ばず、ファイルも書かない |
| `npm run dev` | Next.js 開発サーバー |
| `npm run build` | 静的書き出し（`out/`） |
| `npm run typecheck` | `tsc --noEmit` |

---

## 3. 環境変数

| 変数 | 必須 | 既定値 | 用途 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 要約する場合は必須 | なし | Claude API キー |
| `WINDOW_HOURS` | | `36` | 何時間前までの記事を対象にするか |
| `MAX_ARTICLES` | | `30` | 1 日に掲載する最大件数 |
| `MAX_SUMMARIZE` | | 無制限 | 要約に回す最大件数。詳細は §5.2 |
| `NEXT_PUBLIC_BASE_PATH` | | 空 | GitHub Pages のサブパス（例 `/ai-news-digest`） |

`ANTHROPIC_API_KEY` が無い場合、要約はスキップされ配信元の概要がそのまま使われる
（記事カードに「要約なし（配信元の概要）」と表示される）。収集自体は止まらない。

---

## 4. ソースの追加・変更

`config/sources.json` の配列に 1 件足すだけ。コードの変更は要らない。

```json
{
  "name": "表示に使う出典名",
  "url": "https://example.com/feed.xml",
  "category": "モデル/研究",
  "lang": "ja",
  "weight": 7,
  "type": "rss"
}
```

| フィールド | 必須 | 説明 |
|---|---|---|
| `name` | ○ | サイト上の「出典:」に出る名前。記事の識別にも使う |
| `url` | ○ | RSS/Atom の URL、または API のエンドポイント |
| `category` | ○ | 既定カテゴリ。要約が失敗したときのフォールバックに使う |
| `lang` | ○ | `ja` / `en` |
| `weight` | ○ | 重複が出たときにどちらを残すか。**大きいほど優先** |
| `type` | | `rss`（既定）/ `arxiv` / `hn-algolia` |
| `minPoints` | | `hn-algolia` のときの最低スコア |
| `enabled` | | `false` にすると一時的に無効化できる |
| `note` | | 覚え書き。処理には使わない |

`weight` の目安（現在の設定）:

| weight | ソース |
|---|---|
| 10 | Anthropic News / OpenAI Blog（一次情報） |
| 9 | Google AI Blog / Google DeepMind |
| 7〜8 | Meta AI / MIT Technology Review / Hugging Face / ITmedia AI+ |
| 5〜6 | TechCrunch / The Verge / VentureBeat / Publickey / Ars Technica / Hacker News |
| 4 | arXiv cs.AI（本数が多く速報性が低いので低め） |

### 追加する前に URL を確かめる

RSS の URL は公式サイトの表記と実際が食い違うことが多い。追加前に必ず叩く。

```bash
curl -sSL --max-time 10 -o /tmp/feed.xml -w "%{http_code}\n" "<追加したいURL>"
grep -c '<item>\|<entry' /tmp/feed.xml
```

`404` が返る／`items` が 0 なら、そのフィードは存在しない。

### 初期ソースについての注意

- **Anthropic News** と **Meta AI** は公式 RSS が存在しない。2026-08-26 に以下をすべて実際に叩き、
  **全部 404**（HTML のエラーページが返る）であることを確認した。

  | 試した URL | 結果 |
  |---|---|
  | `https://www.anthropic.com/rss.xml` | 404 |
  | `https://www.anthropic.com/news/rss.xml` | 404 |
  | `https://www.anthropic.com/engineering/rss.xml` | 404 |
  | `https://www.anthropic.com/feed.xml` | 404 |
  | `https://www.anthropic.com/index.xml` | 404 |
  | `https://www.anthropic.com/news.xml` | 404 |
  | `https://ai.meta.com/blog/rss/` | 404 |
  | `https://ai.meta.com/blog/rss.xml` | 404 |

  （`https://research.facebook.com/feed/` は 200 を返すが `lastBuildDate` が 2023-05-17 で
  更新が止まっているため採用していない。）
  代わりに **Google News RSS の `site:` 検索**を使っている。
  リンク先が `news.google.com/rss/articles/...` のリダイレクト URL になる点だけ注意。
  公式フィードが開設されたらこの 2 件は差し替えること。

  **代替が機能しているかは実測済み**: 2026-08-27 の収集で Anthropic News は 4 件取得し
  掲載 30 件にも 1 件入った。Meta AI はフィードに 100 件あるが 36 時間以内の新着が 0 件
  （Meta AI ブログ自体の更新が止まっている）。この 0 件は
  `stats.sources[].itemsInFeed` と `fetched` の差で機械的に区別できる（§5.3）。
- **Ars Technica** はサイト全体のフィード（`feeds.arstechnica.com/arstechnica/index`）だと
  自転車やスペースの記事まで混ざるので、AI カテゴリ専用の
  `https://arstechnica.com/ai/feed/` を使っている。
- **Hacker News** は Algolia API を叩き、`points >= 100` かつ
  タイトルが AI 関連キーワードに当たるものだけを拾う（`scripts/fetch.ts` の
  `HN_AI_PATTERN`）。

---

## 5. 仕様と実装のズレ・監視

### 5.1 重複除去（Jaro-Winkler だけでは判定できない）

要件は「タイトル正規化 + Jaro-Winkler 類似度 0.85 以上を同一記事とみなす」だが、
**Jaro-Winkler 単独では見出しの重複判定はできない**ことが実測でわかった。

2026-08-26 に実際に収集した記事での測定値:

| ペア | 関係 | Jaro-Winkler |
|---|---|---|
| `OpenAI's Jalapeño chip is built for fast inference…` ⇔ `OpenAI says its Jalapeño chip can power…` | **同一記事** | 0.8592 |
| `OpenAI loses a top data center exec as stream…` ⇔ `OpenAI says its Jalapeño chip can power…` | **別記事** | 0.8535 |

差は 0.006 しかない。Jaro-Winkler は本来「人名のような短い文字列」向けの指標で、
長い見出しでは共通接頭辞（この例では `openai `）への加点が効きすぎる。
閾値 0.85 をそのまま適用すると、**無関係な記事が消える**。

そこで `scripts/dedupe.ts` では、要件どおり **Jaro-Winkler >= 0.85 を必要条件として残しつつ**、
追加で「内容語（ストップワードを除いた語）が 2 語以上共通し、Jaccard 係数 0.15 以上」を
満たすことを条件にしている。これは要件より**保守的**（消しすぎない）側への変更である。

- 消しすぎる誤り = 実在するニュースが黙って消える（気づけない）
- 消し漏らす誤り = 同じニュースが 2 枚並ぶ（見ればわかる）

後者のほうが実害が小さいので、そちらに倒した。

分かち書きされない日本語の見出しは内容語に分解できないため、この追加条件は適用せず
Jaro-Winkler の結果をそのまま使う。

**この調整の根拠は上の 2 ペアのみ（n=2）である。** ソースを増やしたら再測すること。
同一企業の別発表（例: `OpenAI launches X for developers` と `OpenAI launches Y for developers`）は
内容語も重なるため、依然として誤マージしうる。

閾値を変えたい場合は `scripts/dedupe.ts` の `TITLE_SIMILARITY_THRESHOLD` と
`looksLikeSameStory()` を見ること。

消した件数は `stats.removedByUrl` / `stats.removedByTitle` に残る。
消しすぎていないかは、この数値が急に増えていないかで監視する。

### 5.2 要約対象の件数（`MAX_SUMMARIZE`）

既定では**重複除去後の全件**を要約する。

当初は API コスト削減のため weight 上位 60 件に絞っていたが、これは 2 つの点で害があった。

1. weight が「重複時のタイブレーク」から「掲載可否のゲート」に格上げされ、
   低 weight のソース（arXiv・Hacker News・Ars Technica）が importance によらず
   構造的に載らなくなる
2. importance は 1 バッチ 10 件の**相対比較**で付くため、weight 順に切り出すと
   バッチ間で較正されない（高 weight だけのバッチと arXiv だけのバッチができる）

実測（2026-08-27、126 件）:

| | 60 件足切りあり | 全件要約 |
|---|---|---|
| 掲載 30 件に登場したソース数 | 9 | **12** |
| 使われたカテゴリ数 | 5 | **6** |
| 最多ソースの占有率 | ITmedia 13/30 (43%) | ITmedia 10/30 (33%) |

コストを抑えたい場合のみ `MAX_SUMMARIZE=60` のように設定する。
設定した場合は「weight 下位を要約対象から除外した」旨が実行ログに出る。

### 5.3 ソースが静かに 0 件になったことを検出する

`failedSources` は**例外が出たときしか埋まらない**。
HTTP 200 で中身が空のフィードは「成功・0 件」になるため、これだけを見ていると
配信元が止まったことに気づけない。そこで `stats.sources[]` に全ソース分の内訳を残している。

| フィールド | 意味 |
|---|---|
| `itemsInFeed` | フィードに入っていた総件数（時間フィルタ前）。**0 なら配信元が空を返している** |
| `fetched` | 36 時間フィルタを通った件数 |
| `ok` / `error` | 例外の有無 |

さらに集計として:

- `stats.emptySources` — HTTP は成功したがフィードが空だったソース
- `stats.absentFromDigest` — 最終的な掲載 30 件に 1 件も載らなかったソース

**同じソースがこれらに数日連続で出てきたら、URL の陳腐化を疑って `config/sources.json` を見直す。**

---

## 6. データ形式

### `data/articles/YYYY-MM-DD.json`

```jsonc
{
  "date": "2026-08-26",
  "generatedAt": "2026-08-26T12:36:12.008Z",
  "count": 30,
  "stats": {
    "fetched": 127,             // 収集できた総数
    "afterDedupe": 126,         // 重複除去後
    "published": 30,            // 掲載した数
    "removedByUrl": 0,          // URL正規化での完全一致で消した数
    "removedByTitle": 1,        // タイトル類似で消した数
    "failedSources": [],        // 例外で落ちたソースと理由
    "emptySources": [],         // HTTP成功だがフィードが空だったソース
    "absentFromDigest": [       // 掲載30件に1件も載らなかったソース
      "Google AI Blog", "Meta AI", "Hugging Face Blog"
    ],
    "summarized": 126,          // 要約に回した数
    "summaryFailures": 0,       // 要約に失敗して description を流用した数
    "sources": [                // ソース別の内訳（§5.3）
      { "name": "Anthropic News", "weight": 10, "itemsInFeed": 100,
        "fetched": 4, "ok": true, "durationMs": 574 }
    ]
  },
  "articles": [
    {
      "id": "05f45dd4d9cc",           // 正規化後URLの SHA-1 先頭12桁
      "title": "…",
      "url": "https://…",
      "source": "ITmedia AI+",
      "sourceWeight": 7,
      "sourceCategory": "その他",
      "lang": "ja",
      "publishedAt": "2026-08-26T11:10:49.000Z",
      "description": "…",            // 配信元の概要（要約の根拠）
      "summary": "…",                // Claude が生成した日本語要約
      "category": "プロダクト",
      "tags": ["…"],                 // 最大3
      "importance": 4                // 1〜5
      // "summaryFailed": true        // 要約に失敗した場合のみ付く
    }
  ]
}
```

同じ日に 2 回実行されるため、2 回目は既存ファイルとマージしたうえで
上位 30 件に絞り直す（`mergeWithExisting()`）。`id` は**正規化後の URL** から作るので、
utm パラメータが変わっただけの再取得は同一記事として扱われる。

**マージ後も上位 30 件に絞るため、朝に掲載された記事が夜の実行で押し出されることがある。**
「上位 30 件」を 1 回の実行あたりと読むか、その日の最終形と読むかで挙動が変わる。
その日に一度載せた記事を落としたくない場合は `MAX_ARTICLES` を上げるか、
`build-data.ts` の `rank(merged).slice(0, MAX_ARTICLES)` を変更する（§11 参照）。

### `data/index.json`

```jsonc
{
  "updatedAt": "2026-08-26T18:40:05.693Z",
  "lastAttemptedAt": "2026-08-26T18:37:36.613Z",  // 収集を試みた時刻。0件でスキップしても更新される
  "dates": [{ "date": "2026-08-27", "count": 30, "generatedAt": "…" }]
}
```

`data/articles/` を走査して毎回作り直すので、手でファイルを消しても整合する。

---

## 7. GitHub Actions

`.github/workflows/daily.yml`

- `cron: '0 22,10 * * *'`（UTC）= **07:00 / 19:00 JST**
- `workflow_dispatch` で手動実行もできる
- 流れ: checkout → setup-node(22) → `npm ci` → `npm run collect` →
  `data/` に差分があればコミット&プッシュ → `npm run build` → `gh-pages` へデプロイ
- **収集が 0 件でもワークフローは失敗しない。**
  0 件のときは記事ファイルを上書きせず、直前のダイジェストがそのまま残る。
  ただし「試みた」記録として `data/index.json` の `lastAttemptedAt` は更新される
- 収集ステップは `continue-on-error: true`。収集が例外で落ちてもサイトのビルドとデプロイは進む
  （データ更新とデプロイを結合させると、収集の一時的な失敗でサイト全体が更新されなくなるため）。
  失敗した事実は Actions 上でステップが赤くなることで残る
- `data/` の push は実行中に人間が push した場合に備えて `git pull --rebase` を挟み最大3回試す。
  3回失敗しても警告を出すだけでデプロイは続行する

### 公開までに必要な設定

1. **Secrets の登録**
   リポジトリ Settings → Secrets and variables → Actions → New repository secret
   - Name: `ANTHROPIC_API_KEY`
   - Secret: 発行した API キー

2. **Actions の書き込み権限**
   Settings → Actions → General → Workflow permissions を
   **Read and write permissions** にする（`data/` のコミットと `gh-pages` の push に要る）。

3. **Pages の公開元**
   Settings → Pages → Build and deployment → Source を
   **Deploy from a branch** にし、Branch を **`gh-pages` / `(root)`** にする。

4. **`NEXT_PUBLIC_BASE_PATH`**
   ワークフローが自動で `/<リポジトリ名>` を渡す。
   `<owner>.github.io` というリポジトリ名でユーザーサイトとして公開する場合のみ、
   `daily.yml` の `NEXT_PUBLIC_BASE_PATH` を空文字にすること。

### 運用上の注意

- **ブランチ保護**: デフォルトブランチを保護している場合、`data/` の push が通らない。
  github-actions[bot] を保護の例外に加えるか、data 用のブランチに分ける
- **第三者アクションの固定**: `peaceiris/actions-gh-pages@v4` をタグ参照している。
  このジョブは `contents: write` を持つので、本番運用に入れる前にコミット SHA でピンすること
  （タグは後から差し替えられる）
- **schedule の自動停止**: public リポジトリでは一定期間リポジトリに活動がないと
  スケジュール実行が自動で無効化される。bot の push がこの「活動」に数えられるかは未検証。
  止まっても通知は来ず、サイトは古いまま生き続けるので、
  ときどき `data/index.json` の `lastAttemptedAt` を確認すること
- **cron の遅延**: GitHub Actions の cron は数分〜数十分遅れ、まれにスキップされる。
  「07:00 きっかり」ではない
- **gh-pages 履歴の肥大化**: 日付プルダウンが全ページに全日付リストを埋め込むため、
  1 日増えるたびに過去の全 HTML が変わる。デプロイ 2 回/日 × N ページで
  `gh-pages` の履歴は O(N²) で膨らむ。掲載日数が 100 日を超えたら履歴サイズと
  ビルド時間を測り、必要なら `peaceiris/actions-gh-pages` の `force_orphan: true` を検討する。
  `data/` 自体は 1 日 25〜60KB（1 年で 10〜20MB）で問題にならない

---

## 8. サイトの構成

| パス | 内容 |
|---|---|
| `/` | 最新日のダイジェスト。カテゴリ別セクション |
| `/d/YYYY-MM-DD/` | 指定日のダイジェスト。アーカイブと日付プルダウンはすべてこちらを指す |
| `/archive/` | 過去日の一覧 |

- 上部にカテゴリのフィルタチップと日付切り替えのプルダウン
- 記事カードは詳細を開かない。**「出典を読む →」で元記事を別タブで開く**
  （`target="_blank" rel="noopener noreferrer"`）
- 各カードに出典名・公開時刻・重要度バッジ・タグを表示
- ダークモード対応（初回は OS 設定に従い、ヘッダーのボタンで切り替えて `localStorage` に保存）
- モバイルファースト。タッチ領域は 44px 以上

### デザイン

`~/.claude/docs/DESIGN.md`（DFE Design System）のトークンに従っている。
色・角丸・タイポグラフィのスケールは `src/app/globals.css` の `@theme` にまとめてある。
アイコンは絵文字を使わず `src/components/Icons.tsx` の SVG を使う。

### 日本語フォントについて

**Web フォントは 1 つも読み込んでいない。** 日本語のフルセットは数 MB になり、
1 日 2 回更新されるニュースサイトでは読み込みコストに見合わないため。

`globals.css` の `--font-sans` は DESIGN.md §3 の指定どおり `'Noto Sans JP'` から始まるが、
これは `@font-face` を伴わない**ローカルフォント名の参照**である。
端末に Noto Sans JP が入っていればそれが使われ（Android など）、
入っていなければ次の候補（macOS のヒラギノ、Windows の游ゴシック等）に落ちる。
ネットワーク越しの取得は発生しない。

組版は以下で詰めている。

- `font-feature-settings: 'palt' 1, 'kern' 1`（プロポーショナル詰め）
- 本文 `line-height: 1.8` / `letter-spacing: 0.04em`
- 見出しは `word-break: keep-all`、本文は `word-break: auto-phrase`（文節で折り返す）

---

## 9. 著作権についての方針

- 取得・保存するのは **タイトル / URL / 出典名 / 公開時刻 / 配信元が提供する概要** のみ。
  記事本文の全文取得・保存は行わない。
- 要約はタイトルと配信元の概要のみを根拠に生成し、
  原文の言い回しをそのまま写さないようプロンプトで指示している。
- すべてのカードに出典名を明記し、元記事へのリンクを置いている。
- フッターに、内容は出典元で確認するよう注記を出している。

---

## 10. 既知の限界・依頼者の判断が要る点

実装側で決めきれない、または既知だが直していない点。運用に入る前に確認すること。

### 10.1 日をまたぐ重複（既知・未対応）

収集ウィンドウは 36 時間だが、ファイルは JST の日付ごとに作る。
23:00 JST 公開の記事は当日ファイルと翌日ファイルの**両方に載りうる**。
日をまたいだ重複除去は実装していない。
気になる場合は `WINDOW_HOURS=24` にするか、`build-data.ts` で前日ファイルの `id` を
除外する処理を足す。

### 10.2 朝の記事が夜に消える（要件が曖昧）

§6 のとおり、夜の実行でマージ後に上位 30 件へ絞り直すため、
朝に載った記事が押し出されることがある。「上位 30 件」が
**1 回の実行あたり**なのか**その日の最終形**なのかは要件から読み取れない。

| 案 | 得るもの | 失うもの |
|---|---|---|
| A. 現状（上書き優先） | 常に最新 30 件 | 朝読んだ記事が夜に消える |
| B. その日一度載せたら落とさない | 「その日のダイジェスト」として一貫する | 件数が 30 を超える |
| C. 朝版・夜版を別データにする | 両方残る | 実装と URL 設計の変更が要る |

### 10.3 配信元のリード文の保存・再配布（法務確認が未了）

`description`（配信元のリード文）を `data/` に保存し、公開リポジトリにコミットしている。
要約に失敗した場合はこれをそのまま画面に表示する。
§9 の方針は「記事本文の全文取得・保存はしない」であって、
**リード文の保存・再配布が各配信元の利用条件で許されるかは確認していない**。
ITmedia 等の RSS 利用条件と、Google News RSS の再配信可否は公開前に確認すること。

### 10.4 リポジトリの公開範囲

GitHub Pages を無料で使うには public が前提。public にすると
`data/` の全記事メタデータ・生成した要約・`config/sources.json`・本 README の運用手順が
すべて公開される。

### 10.5 出典名の粒度

`ITmedia AI+` のフィードには atmarkit / MONOist / ITmedia NEWS の記事が混ざるが、
サイト上の出典表記はすべて「出典: ITmedia AI+」になる。
実際の媒体名を出したい場合は `fetch.ts` で記事 URL のホスト名から出し分ける必要がある。

### 10.6 要約品質は機械検証していない

`summary` が誤要約でないか、原文の言い回しを写していないかは自動判定していない。
プロンプトで指示しているだけである。抜き取りでの目視確認を推奨する。

---

## 11. ディレクトリ

```
.
├── .github/workflows/daily.yml   自動実行
├── config/sources.json           収集ソースの定義
├── data/
│   ├── index.json                日付の一覧
│   └── articles/YYYY-MM-DD.json  日次ダイジェスト
├── scripts/
│   ├── types.ts                  共通の型・カテゴリ定義
│   ├── fetch.ts                  収集（RSS / arXiv / HN）
│   ├── dedupe.ts                 重複除去（URL正規化 + Jaro-Winkler）
│   ├── summarize.ts              Claude での要約
│   └── build-data.ts             上記をつないで JSON 出力
├── src/
│   ├── app/                      Next.js App Router
│   ├── components/               UI コンポーネント
│   └── lib/                      data 読み込み・整形
├── .env.example                  環境変数のひな形
├── README.md
└── next.config.ts
```
