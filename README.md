# KIRA Activity

Death Note L風のアクティビティ可視化ウィジェット。GitHubやはてなブックマークの活動パターンをアニメーションで表示。

## 特徴

- 4段階の可視化（ランダム→カレンダー→週次グラフ→3D）
- Death Note風デザイン（黒背景、緑文字、赤アクセント）
- WebP画像出力（GitHub READMEに埋め込み可能）
- GitHub / はてなブックマーク対応

## 使い方

```bash
git clone https://github.com/kako-jun/kira-activity.git
cd kira-activity
npm install
cp .env.example .env
# .envにGITHUB_TOKENを設定（推奨）
npm start
```

### 画像の埋め込み

```markdown
![Activity](http://localhost:3000/api/graph?user=YOUR_USERNAME)
```

### API

- `GET /api/graph?user=xxx` - アニメーション生成
- `GET /api/frame?user=xxx&step=4` - 特定ステップの静止画
- `GET /health` - ヘルスチェック

### パラメータ

- `user`: ユーザー名（必須）
- `source`: `github`（デフォルト）または `hatena`
- `step`: 1〜4（frameのみ）
- `size`: `small` / `medium` / `large`

## 技術スタック

- Node.js / Bun + Express
- Puppeteer + Three.js
- Sharp

## ライセンス

MIT
