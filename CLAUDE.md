# KIRA Activity 開発者向けドキュメント

映画『デスノート The Last Name』のLの分析シーンに着想を得た、活動可視化ウィジェット。

## コンセプト

L がキラの活動パターンを段階的に分析していくシーンを再現:

- **kira** — 曜日 × 時刻 × 活動量の 3D 表示（全体像）
- **month** — 直近 ~30 日のカレンダー俯瞰。日セル濃度 + per-cell 24h strip で時刻帯まで読める中間ビュー
- **week** — 7 × 24 グリッドへの週次累積オーバーレイ。繰り返し bias を可視化する MVP の主役

`auto` モードはこの 3 ビューを順に再生する。

## アーキテクチャ

`/viewer` を**正本のレンダラー**とし、`/image` はその上に乗る WebP エクスポート層。

```
Client ──> Hono Server ──┬── /viewer      (HTML, iframe 用)
                         │       │
                         │       └── 同じクエリ仕様
                         │              │
                         └── /image     (Puppeteer + Sharp で /viewer?view=auto を WebP 化)
                                ↑
                                └── /viewer?view=kira|month|week なら単一ビュー WebP
```

データ取得層は `services/github.js` / `services/hatena.js`、変換は `utils/data-processor.js`、描画は `renderer/graph.html`。

## プロジェクト構造

```
kira-activity/
├── src/
│   ├── server.js                 # Hono サーバー（エントリーポイント）
│   ├── services/
│   │   ├── registry.js           # provider registry + 共通 fetchActivity dispatcher
│   │   ├── github.js             # GitHub API クライアント
│   │   ├── hatena.js             # はてなブックマーク API
│   │   ├── rss.js                # 汎用 RSS/Atom/RDF フィードクライアント
│   │   └── cache.js              # キャッシュ管理
│   ├── renderer/
│   │   ├── embed.html            # /viewer の HTML テンプレート（ファイル名は git history 都合で温存）
│   │   ├── graph.html            # Three.js 可視化テンプレート（Puppeteer 用）
│   │   └── webp-generator.js     # Puppeteer + WebP 生成
│   └── utils/
│       └── data-processor.js     # データ変換ロジック
├── package.json
└── .env.example
```

## Provider アーキテクチャ

データソース層は `src/services/registry.js` の **provider registry** に集約されている。
ルーティング層・レンダリング層からはソース固有の分岐が完全に消えており、新しいデータ
ソースを追加するには registry に 1 エントリ足すだけで済む。

```
server.js ──> services/registry.js ──┬── github (GitHubClient adapter)
   │              │                  ├── hatena (HatenaBookmarkClient adapter)
   │              │                  └── rss    (RssAtomFeedClient adapter)
   │              │
   │              └── fetchActivity(source, { user, feed }) — 共通契約
   ▼
webp-generator.js / data-processor.js
   ↑
   └── ソース固有の if/else は持たない（normalized activity だけを消費）
```

### Provider contract

```js
{
  source: 'github',
  fetchActivity: async ({ user, feed }) => NormalizedActivity
}
```

`NormalizedActivity` の target shape:

```js
{
  username,
  totalActivity,
  events: [
    { date, type, title?, url?, repo?, meta? }
  ],
  fetchedAt
}
```

現状の各 client（`GitHubClient` / `HatenaBookmarkClient` / `RssAtomFeedClient`）の
`getComprehensiveActivity` 戻り値はこの shape にすでに十分互換で、`events[]` 内の
個別エントリは `event.message || event.title || event.comment || 'Activity'` のような
data-processor 側のフォールバックを通って消費される。target shape は forward-looking な
ガイドラインで、後方互換のために既存の event 形を強制変換はしない。

### `VALID_SOURCES` の真の source-of-truth

`server.js` の `VALID_SOURCES` は `registry.js` の `SUPPORTED_SOURCES` から導出して
いる。新しい source を増やすときは:

1. `services/registry.js` の `PROVIDERS` に 1 エントリを追加（必要なら新しい client を import）
2. data fetch contract はそれで完結。route / webp-generator / palette は触らない

ただし route policy（user の文字種、必要な追加クエリ、エラーマスキング等）は source
固有の判断が残る。新 source が github/hatena 系の ID-style か rss 系の URL-style か
で決まらない第三カテゴリ（OAuth 認証など）の場合は `server.js` 側のバリデーション・
キャッシュキーにも分岐が必要。registry は data layer の統一であって、route layer の
policy は別軸。

### in-flight dedup

`/viewer` は kira / month / week の 3 ビュー WebP を並列に pre-warm するため、同じ
`(source, user, feed)` に対して 3 連射の fetch が走る可能性がある。registry の
`fetchActivity` は `inFlight: Map<key, Promise>` で in-flight な Promise を共有し、
upstream fetch を 1 回に集約する。`finally` で entry を消すので、エラーが永続キャッシュ
に化けることはない。以前 webp-generator にあった `inFlightFeeds`（rss 専用）は
registry に統合済み — 全 source に対して同じ dedup ロジックが効く。dedup の identity
は provider が `inflightIdentity()` で上書きできる: rss は user がラベル扱いなので
feed のみで keying し、同じ feed を別ラベルで叩く並列リクエストも 1 fetch に集約する。

## エンドポイント

| パス | 説明 |
|---|---|
| `GET /` | デモページ（HTML） |
| `GET /health` | ヘルスチェック |
| `GET /viewer` | 正本レンダラー（HTML） |
| `GET /image` | `/viewer` の WebP エクスポート |

旧 `/api/frame` は廃止。単一ビュー出力は `/image?view=kira|month|week` を使う。
旧 `/embed` / `/api/graph` も Phase 8 で `/viewer` / `/image` に改名済み（後方互換なし）。

## 共有クエリパラメータ

`/viewer` と `/image` で同じ仕様。

- `user` (必須。`source=rss` のときは表示用ラベル)
- `source` (`github` | `hatena` | `rss`、default `github`)
- `theme` (`film` | `github` | `hatena` | `sepia` | `mono`、default `film`)
- `size` (`small` | `medium` | `large`、default `medium`)
- `view` (`kira` | `month` | `week` | `auto`、default `auto`)
- `feed` (`source=rss` のとき必須、http(s) URL、最大 1024 文字。それ以外の source では捨てる)

`VALID_SOURCES = { github, hatena, rss }`。`source=rss` は Atom 1.0 / RSS 2.0 / RDF を
読み、各 entry/item を `{ type:'article', date, title, url }` に正規化して既存の
data-processor にそのまま流し込む。フィードは直近 10〜50 件しか露出しないことが多い
ので、week ビューの累積は短期 posting-time bias の表示として読む（長期 edit 活動の
追跡用ではない）。

#### `user` パターンの分岐

`source=github` / `source=hatena` の `user` は外部 API に渡るので
`USER_PATTERN_GH_LIKE = /^[A-Za-z0-9_-]{1,39}$/` に固定する。`source=rss` の `user` は
表示用ラベルにしか使わず、外部 API には行かないので、Unicode の文字 / 数字 / 句読点 /
空白を許容する `USER_PATTERN_LABEL = /^[\p{L}\p{N}\p{P}\s_-]{1,64}$/u` に切り替える。
XSS は既存の `JSON.stringify(...).replace(/</g, '\\u003c')` 注入パターンが守る。

#### `source=rss` のキャッシュキー

`source=github` / `source=hatena` のキャッシュキーは `graph_{source}_{user}_{theme}_{size}_{view}`。
`source=rss` は `feed` URL が一次キーで `user` は表示ラベルなので、キャッシュキーから
`user` を除外して `graph_rss_{theme}_{size}_{view}_{feedKey}` にする。`feedKey` は
`feed` の SHA-256 (base64url, 先頭 16 文字 ≈ 96 bit) で衝突リスクを実用上無視できる
レベルまで下げる。これで同じ feed に対して別ラベルで来たリクエストは同じキャッシュを
共有し、外部 feed への重複 fetch を抑制できる。

#### `source=rss` のセキュリティ・運用制約

- **SSRF 対策**: `feed` のホストは DNS 解決後、private / loopback / link-local /
  metadata IP（`localhost` / `127.0.0.0/8` / `10.0.0.0/8` / `172.16.0.0/12` /
  `192.168.0.0/16` / `169.254.0.0/16` / `0.0.0.0/8` / `::1` / `fc00::/7` /
  `fe80::/10`）であれば拒否する。`axios` の `beforeRedirect` でリダイレクト先も
  再検証する。`username` / `password` を含む URL も拒否
- **XXE 対策**: 取得した body の先頭 4 KB に `<!DOCTYPE` / `<!ENTITY` が含まれていたら
  xml2js に渡す前に reject する（billion-laughs / 外部実体展開対策）
- **URL 長制限**: `feed` は 1024 文字以内（Cloudflare 等の CDN 長さ制限を考慮）
- **in-flight dedup**: `/viewer` の 3 ビュー pre-warm が同じ feed に対して 3 連射しても、
  webp-generator の module-level `inFlightFeeds: Map<feedUrl, Promise>` が単一の
  Promise を共有するので fetch は 1 回に集約される
- **エラー応答**: `source=rss` 経路の 500 は `details: 'feed fetch failed'` の
  generic 文言にする（探索性のある details の露出を防ぐ）

公開 API では `step` 語彙を使わない。`step1..step4` は `data-processor.js` の内部キーと
`graph.html` の内部シーン番号にだけ残る実装詳細。

## 内部 view ↔ scene マッピング

`webp-generator.js` 内で公開ビュー名を Three.js 側のシーン番号に変換する。

| 公開 view | 内部 scene | renderScene 関数 | 内容 |
|---|---|---|---|
| `kira` | 4 | `renderScene4()` | 曜日 × 時刻の活動量を 3D サーフェスで俯瞰、ピーク時刻が発光ラインで強調 |
| `month` | 2 | `renderScene2()` | 直近 ~30 日を Sun..Sat 7 列カレンダーで配置。日セルの濃度 + per-cell 24h strip |
| `week` | 3 | `renderScene3()` | 7 × 24 グリッドに週ごとの活動を半透明レイヤーとして累積 |

scene 1（ランダムリスト）は補助演出。本番ループには含めない。

## Palette アーキテクチャ

配色は `src/renderer/palette.js` に集約された 5 トークン（background / ink / grid /
accent / highlight）× 5 テーマで定義する。

- `theme=film` のときだけ `source` に応じて accent が変わる（`github`→くすんだ緑、
  `hatena`→くすんだ青）。background / ink / grid / highlight はフィルム配色のまま。
- 他のテーマ（`github` / `hatena` / `sepia` / `mono`）はテーマ自身の配色を優先し、
  source による accent 切り替えは行わない。
- パレットはサーバ側で 1 回だけ resolve し、`/viewer` には CSS 変数（`--kira-bg` ほか）
  として、`/image` には `window.RENDER_PALETTE` として注入される。
- CSS 注入の安全性は `sanitizePalette()` が `^#[0-9a-fA-F]{6}$` を保証することで担保。
  JS 注入は既存の `JSON.stringify(...).replace(/</g, '\\u003c')` パターン。

Phase 1 では scene 1..4 内の最も目立つハードコード色（背景・軸・グリッド・線・
ドット・3D エッジ）だけパレット化し、ツールチップ等の細部は Phase 2/3 の再設計で扱う。

## レンダリングフロー

1. データ取得（GitHub API / Hatena RSS）
2. データ変換（4 シーン分のキーに整形 — 内部実装詳細）
3. 並列レンダリング（Puppeteer + Three.js）
4. WebP 変換（各フレーム: Sharp で静止 WebP encode → アニメ化が必要な
   `view=auto` のみ node-webpmux で 1 枚の animated WebP に mux）

## パフォーマンス最適化

### 1. ブラウザインスタンスの再利用（Singleton）

```javascript
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({ ... });
  }
  return browserInstance;
}
```

効果: 初回 2.5 秒 → 2 回目以降 0 秒。

### 2. 並列レンダリング

```javascript
const frames = await Promise.all(
  ['kira', 'month', 'week'].map((view) =>
    renderScene(processedData, VIEW_TO_SCENE[view], theme, size)
  )
);
```

効果: 直列 18 秒 → 並列 4.5 秒。

### 3. HTML テンプレートキャッシュ

テンプレートを一度読み込んでメモリにキャッシュ。リクエストあたり 50–100 ms 削減。

### 4. Bun 対応

Node.js より 2–3 倍高速（`bun src/server.js`）。

### ベンチマーク

| 最適化 | Node.js | Bun |
|---|---|---|
| 最適化前 | 約 18 秒 | 約 12 秒 |
| 最適化後 | 約 6 秒 | 約 4 秒 |

## データ構造

### month ビューのデータ（内部キー: `step2`）

```javascript
{
  full: { '2024-01-15': [0, 0, 3, 5, 2, ...] },  // 24 時間分
  weeks: [
    [{ date: '2024-01-15', dayOfWeek: 1, hours: [...] }],
  ]
}
```

### kira ビューのデータ（内部キー: `step4`）

曜日 × 時間グリッド（7 × 24 = 168 要素）。

## 重要ファイル

### src/renderer/webp-generator.js

- 最も複雑なファイル
- `generateAnimatedWebP(user, source, theme, size)` と `generateView(user, source, view, theme, size)` を export
- ブラウザインスタンスのシングルトン管理
- 並列フレーム生成
- 公開 view 名 → 内部 scene 番号の変換はここに集中
- **Phase 5**: `createAnimatedWebP(frames, delays)` は sharp で各フレームを
  個別の静止 WebP にエンコードしたあと、`node-webpmux`（JS + WebAssembly、
  ネイティブビルド依存なし、ライセンスは LGPL-3.0-or-later）で VP8X + ANIM
  + ANMF×N の真の animated WebP コンテナに muxing する。
  sharp 自体は静止フレーム配列から animated WebP を生成できない（animated 出力は
  既に animated な入力の再エンコードのみ対応、`join: { animated: true }` は
  単ページ WebP に潰れる）ため、muxer を分離している。per-frame `delay` は
  ALL_VIEWS の順序（kira → month → week）と一致する `[4000, 2500, 5000]` ms、
  `loops: 0` で無限ループ。`view=kira|month|week` の単一ビューは引き続き
  静止 WebP（`generateView` 経由）

### src/renderer/graph.html

- Three.js による可視化
- 4 つの `renderScene{N}()` 関数
- `window.ACTIVITY_DATA` / `window.RENDER_SCENE` / `window.RENDER_THEME` / `window.RENDER_PALETTE` でデータ注入

### src/renderer/embed.html

- `/viewer` が返す HTML（ファイル名 `embed.html` は git history 都合で温存）
- `<img id="kira-image">` に `/image` を読み込ませて表示する。Three.js は
  サーバ側 Puppeteer がすでに WebP 化しているので、iframe では再実行しない
- `view=auto`: クライアント側で単一ビュー WebP（kira / month / week）をサイクル
  時間ごとに `<img>.src` swap し、ドットと画像を完全同期させる。`performance.now()`
  起点の RAF ループ。サイクル長は kira 4s + month 2.5s + week 5s = 11.5s で
  `webp-generator.js` の dwell time と一致させる。Phase 5 で `/image` が真の
  animated WebP を返すようになったが、embed.html 側の単一ビュー swap 同期ロジック
  はそのまま維持している（巨大 animated WebP のロード待ちが iframe で目立ちやすく、
  単一ビュー pre-warm + クライアント同期の方が体感品質が高いため）
- `view=kira|month|week`: 単一ビュー WebP を表示し、該当ドットだけ active
- ドットクリック / Enter / Space: auto 同期を停止し、CSS opacity フェード
  （400ms ease-in-out）で単一ビュー WebP に差し替え。`swapSeq` トークンで
  重複 swap の race を防止。URL は変更しない（埋め込み先が制御するため）
- 3 つの単一ビュー（kira + month + week）を初期 load 時に並列 pre-warm して
  サーバ側 NodeCache（TTL 3600s）をウォームアップ。`auto` は embed 側で使わない
- ロード失敗時は `#error-label` に "unable to load activity" を控えめに表示

### src/utils/data-processor.js

- 生データを 4 シーン分のキー（`step1..step4`）に変換
- 内部実装のキー名であり、公開 API には露出しない

## 開発時の注意点

- `webp-generator.js` 編集時: ブラウザインスタンスのライフサイクル、並列処理、メモリリーク
- `graph.html` 編集時: Three.js のシーン構築とクリーンアップ
- `data-processor.js` 編集時: month ビューが依存する `weeks` 配列構造を変更しない

## 環境変数

```env
PORT=3000
GITHUB_TOKEN=ghp_xxx    # 推奨（レート制限回避）
CACHE_TTL=3600
NODE_ENV=development
```

## デプロイ

最終的なホスティング先は **Cloudflare**。Hono 採用により Workers / Pages への移行は容易だが、現状は Puppeteer + Sharp（libvips ネイティブバイナリ）に依存するため `@hono/node-server` で Node ランタイムを使う。Cloudflare Workers では Puppeteer / Sharp はそのまま動かないため、Pages + 別 Worker での画像生成 microservice 化が必要（別フェーズ）。

## 参考リンク

- [Hono](https://hono.dev/)
- [Puppeteer API](https://pptr.dev/)
- [Three.js Docs](https://threejs.org/docs/)
- [Sharp Docs](https://sharp.pixelplumbing.com/)
- [node-webpmux](https://www.npmjs.com/package/node-webpmux)
- [Bun Docs](https://bun.sh/docs)
