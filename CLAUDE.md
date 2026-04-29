# KIRA Activity 開発者向けドキュメント

映画『デスノート The Last Name』のLの分析シーンに着想を得た、活動可視化ウィジェット。

## コンセプト

L がキラの活動パターンを段階的に分析していくシーンを再現:

- **kira** — 曜日 × 時刻 × 活動量の 3D 表示（全体像）
- **month** — 直近 ~30 日のカレンダー俯瞰。日セル濃度 + per-cell 24h strip で時刻帯まで読める中間ビュー
- **week** — 7 × 24 グリッドへの週次累積オーバーレイ。繰り返し bias を可視化する MVP の主役

`auto` モードはこの 3 ビューを順に再生する。

## アーキテクチャ

`/embed` を**正本のレンダラー**とし、`/api/graph` はその上に乗る WebP エクスポート層。

```
Client ──> Hono Server ──┬── /embed       (HTML, iframe 用)
                         │       │
                         │       └── 同じクエリ仕様
                         │              │
                         └── /api/graph (Puppeteer + Sharp で /embed?view=auto を WebP 化)
                                ↑
                                └── /embed?view=kira|month|week なら単一ビュー WebP
```

データ取得層は `services/github.js` / `services/hatena.js`、変換は `utils/data-processor.js`、描画は `renderer/graph.html`。

## プロジェクト構造

```
kira-activity/
├── src/
│   ├── server.js                 # Hono サーバー（エントリーポイント）
│   ├── services/
│   │   ├── github.js             # GitHub API クライアント
│   │   ├── hatena.js             # はてなブックマーク API
│   │   ├── rss.js                # 汎用 RSS/Atom/RDF フィードクライアント
│   │   └── cache.js              # キャッシュ管理
│   ├── renderer/
│   │   ├── embed.html            # /embed の HTML テンプレート（Phase 0 placeholder）
│   │   ├── graph.html            # Three.js 可視化テンプレート（Puppeteer 用）
│   │   └── webp-generator.js     # Puppeteer + WebP 生成
│   └── utils/
│       └── data-processor.js     # データ変換ロジック
├── package.json
└── .env.example
```

## エンドポイント

| パス | 説明 |
|---|---|
| `GET /` | デモページ（HTML） |
| `GET /health` | ヘルスチェック |
| `GET /embed` | 正本レンダラー（HTML） |
| `GET /api/graph` | `/embed` の WebP エクスポート |

旧 `/api/frame` は廃止。単一ビュー出力は `/api/graph?view=kira|month|week` を使う。

## 共有クエリパラメータ

`/embed` と `/api/graph` で同じ仕様。

- `user` (必須。`source=rss` のときは表示・キャッシュキー用ラベル)
- `source` (`github` | `hatena` | `rss`、default `github`)
- `theme` (`film` | `github` | `hatena` | `sepia` | `mono`、default `film`)
- `size` (`small` | `medium` | `large`、default `medium`)
- `view` (`kira` | `month` | `week` | `auto`、default `auto`)
- `feed` (`source=rss` のとき必須、http(s) URL。それ以外の source では捨てる)

`VALID_SOURCES = { github, hatena, rss }`。`source=rss` は Atom 1.0 / RSS 2.0 / RDF を
読み、各 entry/item を `{ type:'article', date, title, url }` に正規化して既存の
data-processor にそのまま流し込む。フィードは直近 10〜50 件しか露出しないことが多い
ので、week ビューの累積は短期 posting-time bias の表示として読む（長期 edit 活動の
追跡用ではない）。`feed` の URL ハッシュ（base64url 16 文字）が `/api/graph` の
キャッシュキーに混ぜられるので、同じ user/source で複数フィードを同時運用しても衝突しない。

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
- パレットはサーバ側で 1 回だけ resolve し、`/embed` には CSS 変数（`--kira-bg` ほか）
  として、`/api/graph` には `window.RENDER_PALETTE` として注入される。
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

- `/embed` が返す HTML
- `<img id="kira-image">` に `/api/graph` を読み込ませて表示する。Three.js は
  サーバ側 Puppeteer がすでに WebP 化しているので、iframe では再実行しない
- `view=auto`: クライアント側で単一ビュー WebP（kira / month / week）をサイクル
  時間ごとに `<img>.src` swap し、ドットと画像を完全同期させる。`performance.now()`
  起点の RAF ループ。サイクル長は kira 4s + month 2.5s + week 5s = 11.5s で
  `webp-generator.js` の dwell time と一致させる。Phase 5 で `/api/graph` が真の
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
