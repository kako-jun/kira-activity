# KIRA Activity 開発者向けドキュメント

映画『デスノート The Last Name』のLの分析シーンに着想を得た、活動可視化ウィジェット。

## コンセプト

L がキラの活動パターンを段階的に分析していくシーンを再現:

- **kira** — 曜日 × 時刻 × 活動量の 3D 表示（全体像）
- **month** — 1 か月のカレンダーヒートマップ（中間ビュー）
- **week** — 曜日別の週次 2D 折れ線グラフ（Phase 0 暫定。Phase 2 で 7 × 24 オーバーレイに置換予定）

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

- `user` (必須)
- `source` (`github` | `hatena`、default `github`)
- `theme` (`film` | `github` | `hatena` | `sepia` | `mono`、default `film`)
- `size` (`small` | `medium` | `large`、default `medium`)
- `view` (`kira` | `month` | `week` | `auto`、default `auto`)

公開 API では `step` 語彙を使わない。`step1..step4` は `data-processor.js` の内部キーと
`graph.html` の内部シーン番号にだけ残る実装詳細。

## 内部 view ↔ scene マッピング

`webp-generator.js` 内で公開ビュー名を Three.js 側のシーン番号に変換する。

| 公開 view | 内部 scene | renderScene 関数 | 内容 |
|---|---|---|---|
| `kira` | 4 | `renderScene4()` | 3D 折れ線グラフ |
| `month` | 2 | `renderScene2()` | 月次カレンダーヒートマップ |
| `week` | 3 | `renderScene3()` | 週次 2D 折れ線グラフ |

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
4. WebP 変換（Sharp）

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

### src/renderer/graph.html

- Three.js による可視化
- 4 つの `renderScene{N}()` 関数
- `window.ACTIVITY_DATA` / `window.RENDER_SCENE` / `window.RENDER_THEME` / `window.RENDER_PALETTE` でデータ注入

### src/renderer/embed.html

- `/embed` が返す HTML
- Phase 0 では view 切替の枠組みだけ（ラベル＋カルーセル）
- Phase 2 で本格的な Three.js 表示に置き換える

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

最終的なホスティング先は **Cloudflare**。Hono 採用により Workers / Pages への移行は容易だが、現状は Puppeteer に依存するため `@hono/node-server` で Node ランタイムを使う。Workers 化は別フェーズで検討する。

## 参考リンク

- [Hono](https://hono.dev/)
- [Puppeteer API](https://pptr.dev/)
- [Three.js Docs](https://threejs.org/docs/)
- [Sharp Docs](https://sharp.pixelplumbing.com/)
- [Bun Docs](https://bun.sh/docs)
