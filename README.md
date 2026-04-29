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

`/embed` は `/api/graph` を `<img>` として読み込む。`view=auto` のときは embed 側が
クライアントサイドで単一ビュー WebP（`kira` / `month` / `week`）をサイクル時間ごとに
swap し、下部のカルーセルドットと画像を完全同期させる。ドットをクリックすると自動再生を
停止して該当ビューの単一 WebP に opacity フェードで切り替わる。`view=kira|month|week`
を URL に渡すと最初から特定モードに固定できる。

### README に画像として貼る

```markdown
![Activity](https://example.com/api/graph?user=YOUR_USERNAME)
```

## エンドポイント

- `GET /embed` — 正本レンダラー（HTML を返す）
- `GET /api/graph` — `/embed` の WebP エクスポート。`view=auto`（デフォルト）は kira → month → week をループする真の animated WebP、`view=kira|month|week` は単一ビューの静止 WebP
- `GET /health` — ヘルスチェック

## 共有クエリパラメータ

`/embed` と `/api/graph` で同じクエリ仕様を使う。

| パラメータ | 値 | デフォルト | 説明 |
|---|---|---|---|
| `user` | string | （必須） | ユーザー名（`source=rss` のときは表示・キャッシュキー用ラベル） |
| `source` | `github` / `hatena` / `rss` | `github` | データソース |
| `theme` | `film` / `github` / `hatena` / `sepia` / `mono` | `film` | 配色テーマ |
| `size` | `small` / `medium` / `large` | `medium` | ビューポートサイズ |
| `view` | `kira` / `month` / `week` / `auto` | `auto` | 表示モード |
| `feed` | http(s) URL | — | `source=rss` のときのみ必須。Atom 1.0 / RSS 2.0 / RDF を受け付ける |

#### `source=rss` の限界

任意のブログ・サービスの RSS/Atom フィードを `source=rss&feed=URL` で読ませると、
記事の publish 時刻を「活動イベント」として可視化する。ただし多くのサービスは
フィードに直近 10〜50 件しか含めず、長期 edit 履歴は手に入らない。week ビューの
週次累積は当然この範囲しか積めないので、長期の繰り返し bias 解析というよりは
**直近の posting-time bias** の俯瞰として読むのが妥当。

### ビュー

- `kira` — 曜日 × 時刻の活動量を 3D サーフェスで俯瞰、ピーク時刻が発光ラインで強調
- `month` — 直近 ~30 日を Sun..Sat 7 列カレンダーとして配置。日セルの濃度で日量、セル右の 24 本ストリップで時刻帯を表現
- `week` — 7 × 24 のグリッドに週ごとの活動を半透明レイヤーとして累積。同じ時間帯に活動が重なるほど濃くなり、繰り返し bias が見える
- `auto` — 上記を順に再生するアニメーション（`/api/graph` のデフォルト挙動）

### テーマと source-aware accent

- `film` — クリーム背景 + 濃い灰/茶インク。デスノート分析モニタの温度感
- `github` — GitHub 草ダーク配色（黒背景 + 緑）
- `hatena` — はてな寄り（白背景 + 青）
- `sepia` — 暖色のセピア
- `mono` — 無彩色のニュートラル

`theme=film` のときだけ `source` に応じてアクセント色が変わる: `source=github` で
くすんだ緑、`source=hatena` でくすんだ青。背景・インク・グリッドはフィルム配色のまま
維持される。他のテーマはアクセントを固定し、テーマ自身のアイデンティティを優先する。

## 使用例

- `/embed?user=torvalds` — auto 再生する iframe
- `/embed?user=torvalds&view=kira` — kira 固定の iframe
- `/api/graph?user=torvalds` — auto をアニメ WebP として書き出し
- `/api/graph?user=torvalds&view=week&theme=film&size=large` — 単一ビューの WebP
- `/api/graph?user=torvalds&source=github&theme=film` — film 配色 + GitHub 緑のアクセント
- `/api/graph?user=torvalds&source=hatena&theme=film` — film 配色 + はてな青のアクセント
- `/api/graph?user=foo&source=rss&feed=https%3A%2F%2Fexample.com%2Fatom` — 任意フィードの記事公開時刻を可視化

## 技術スタック

- Node.js / Bun + Hono (`@hono/node-server`)
- Puppeteer + Three.js
- Sharp（フレームを静止 WebP に encode）+ node-webpmux（animated WebP の muxing）

## デプロイ

最終的なホスティング先は **Cloudflare** を想定。Hono 採用により Cloudflare Workers / Pages への移行は容易だが、Phase 0 時点では Puppeteer に依存するため `@hono/node-server` で Node ランタイムを使う。Workers 化は別フェーズで検討する。

## ライセンス

MIT
