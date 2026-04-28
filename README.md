# KIRA Activity

Death Note L 風のアクティビティ可視化ウィジェット。GitHub やはてなブックマークの活動パターンを iframe または animated WebP で表示する。

## アーキテクチャ

`/embed` を**正本のレンダラー**とし、`/api/graph` はその上に乗る WebP エクスポート層。同じクエリ仕様を両方で共有する。

```
/embed  ──── canonical renderer (HTML, iframe 用)
   │
   └─ /api/graph ──── /embed?view=auto を WebP として書き出すエクスポート層
```

## 使い方

```bash
git clone https://github.com/kako-jun/kira-activity.git
cd kira-activity
npm install
cp .env.example .env
# .env に GITHUB_TOKEN を設定（推奨）
npm start
```

### iframe で埋め込む

```html
<iframe src="https://example.com/embed?user=YOUR_USERNAME"></iframe>
```

### README に画像として貼る

```markdown
![Activity](https://example.com/api/graph?user=YOUR_USERNAME)
```

## エンドポイント

- `GET /embed` — 正本レンダラー（HTML を返す）
- `GET /api/graph` — `/embed` の WebP エクスポート
- `GET /health` — ヘルスチェック

## 共有クエリパラメータ

`/embed` と `/api/graph` で同じクエリ仕様を使う。

| パラメータ | 値 | デフォルト | 説明 |
|---|---|---|---|
| `user` | string | （必須） | ユーザー名 |
| `source` | `github` / `hatena` | `github` | データソース |
| `theme` | `deathnote` | `deathnote` | 配色テーマ |
| `size` | `small` / `medium` / `large` | `medium` | ビューポートサイズ |
| `view` | `kira` / `month` / `week` / `auto` | `auto` | 表示モード |

### ビュー

- `kira` — 曜日 × 時刻 × 活動量の 3D 表示
- `month` — 1か月のカレンダーヒートマップ
- `week` — 曜日別の週次 2D 折れ線グラフ（Phase 2 で 7 × 24 オーバーレイに置換予定）
- `auto` — 上記を順に再生するアニメーション（`/api/graph` のデフォルト挙動）

## 使用例

- `/embed?user=torvalds` — auto 再生する iframe
- `/embed?user=torvalds&view=kira` — kira 固定の iframe
- `/api/graph?user=torvalds` — auto をアニメ WebP として書き出し
- `/api/graph?user=torvalds&view=week&theme=deathnote&size=large` — 単一ビューの WebP

## 技術スタック

- Node.js / Bun + Hono (`@hono/node-server`)
- Puppeteer + Three.js
- Sharp

## デプロイ

最終的なホスティング先は **Cloudflare** を想定。Hono 採用により Cloudflare Workers / Pages への移行は容易だが、Phase 0 時点では Puppeteer に依存するため `@hono/node-server` で Node ランタイムを使う。Workers 化は別フェーズで検討する。

## ライセンス

MIT
