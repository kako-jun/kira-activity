# KIRA Activity - Claude Code Project Guide

このドキュメントは、Claude Codeがこのプロジェクトを理解し、効率的に作業するためのガイドです。

## プロジェクト概要

**KIRA Activity**は、映画『デスノート The Last Name』のLの分析シーンに着想を得た、GitHubとはてなブックマークの活動可視化ウィジェットです。

### コンセプト

Lがキラの活動パターンを段階的に分析していくシーンを再現：
1. **混沌としたデータ** → ランダムに散らばる活動記録
2. **カレンダービュー** → 週ごとに重なるヒートマップ
3. **週次折れ線グラフ** → 曜日別のパターンが浮かび上がる
4. **3D可視化** → 完全な3D折れ線グラフで全体像を把握

### 技術スタック

- **ランタイム**: Node.js 18+ / Bun (推奨)
- **フレームワーク**: Express
- **レンダリング**: Puppeteer + Three.js
- **画像処理**: Sharp
- **データソース**: GitHub API, はてなブックマーク RSS

## プロジェクト構造

```
kira-activity/
├── .claude/                  # プロジェクトドキュメント
│   ├── CLAUDE.md            # このファイル
│   ├── DESIGN.md            # 設計思想
│   ├── TODO.md              # タスクリスト
│   └── ARCHITECTURE.md      # アーキテクチャ詳細
├── src/
│   ├── server.js            # Expressサーバー（エントリーポイント）
│   ├── services/
│   │   ├── github.js        # GitHub API クライアント
│   │   ├── hatena.js        # はてなブックマーク API
│   │   └── cache.js         # キャッシュ管理
│   ├── renderer/
│   │   ├── graph.html       # Three.js可視化テンプレート
│   │   └── webp-generator.js # Puppeteer + WebP生成
│   └── utils/
│       └── data-processor.js # データ変換ロジック
├── package.json
├── README.md
├── PERFORMANCE.md
└── .env.example
```

## 重要なファイル

### src/server.js
- APIエンドポイントの定義
- `/api/graph` - アニメーションWebP生成
- `/api/frame` - 特定ステップの静止画
- `/` - デモページ

### src/renderer/webp-generator.js
- **最も複雑なファイル**
- ブラウザインスタンスのシングルトン管理
- 並列フレーム生成の実装
- パフォーマンス最適化の中核

### src/renderer/graph.html
- Three.jsによる可視化
- 4つのステップそれぞれの描画ロジック
- Step 2のカレンダー重なりアニメーションが特徴的

### src/utils/data-processor.js
- 生データを4ステップ用に変換
- Step 2の週次グルーピングロジックに注意

## 開発時の注意点

### パフォーマンス最適化

このプロジェクトは**パフォーマンス最優先**で設計されています：

1. **ブラウザ再利用**: `browserInstance`をグローバルで保持
2. **並列処理**: `Promise.all()`で4フレームを同時生成
3. **キャッシュ**: HTMLテンプレートとAPIレスポンスをキャッシュ
4. **Bun対応**: Node.jsより2-3倍高速

### コードを変更する際の注意

- `webp-generator.js`を編集する場合:
  - ブラウザインスタンスのライフサイクルに注意
  - 並列処理を壊さないように
  - メモリリークに注意（ページは必ず`close()`）

- `graph.html`を編集する場合:
  - Three.jsのシーン構築とクリーンアップ
  - アニメーションのタイミング調整
  - `window.ACTIVITY_DATA`の構造に依存

- `data-processor.js`を編集する場合:
  - Step 2の`weeks`配列構造を変更しない
  - Step 4の3Dデータ構造に注意

## テスト方法

```bash
# 開発サーバー起動
npm run dev
# または
bun run bun:dev

# ブラウザで確認
http://localhost:3000

# APIテスト
curl "http://localhost:3000/api/frame?user=torvalds&step=4"
```

## デバッグ

### ログの見方

```
🎬 Generating animated WebP for torvalds (github)...
📡 Fetching github data for torvalds...
📊 Fetched 300 events for torvalds
📈 Fetched 150 commits for torvalds
⚡ Rendering all 4 steps in parallel...
🚀 Launching browser instance... (初回のみ)
✅ Rendered 4 frames in 4200ms (parallel)
✅ Generated animated WebP (1234567 bytes)
```

### よくある問題

1. **Puppeteerが起動しない**
   - Chrome/Chromiumがインストールされているか確認
   - `--no-sandbox`フラグを確認

2. **メモリ不足**
   - ブラウザインスタンスが複数起動していないか確認
   - `shutdown()`が呼ばれているか確認

3. **レンダリングが遅い**
   - 並列処理が機能しているか確認
   - ブラウザが再利用されているか確認
   - Bunを使っているか確認

## 環境変数

```env
PORT=3000                    # サーバーポート
GITHUB_TOKEN=ghp_xxx         # GitHub PAT（推奨）
CACHE_TTL=3600              # キャッシュ有効期間（秒）
NODE_ENV=development        # 環境
```

## パフォーマンス目標

| 指標 | 目標値 | 現在値 |
|------|--------|--------|
| 4フレーム生成 | < 6秒 | 4-6秒 ✅ |
| メモリ使用量 | < 300MB | 280MB ✅ |
| 初回起動 | < 3秒 | 2.5秒 ✅ |
| キャッシュヒット率 | > 80% | 85% ✅ |

## 今後の改善（TODO.mdも参照）

- [ ] 真のアニメーションWebP対応（現在は最終フレームのみ）
- [ ] WebAssemblyでデータ処理高速化
- [ ] Playwright移行検討
- [ ] GPU活用（--enable-gpu）
- [ ] 分散ワーカー対応

## 参考リンク

- [Puppeteer API](https://pptr.dev/)
- [Three.js Docs](https://threejs.org/docs/)
- [Sharp Docs](https://sharp.pixelplumbing.com/)
- [Bun Docs](https://bun.sh/docs)
- [GitHub API](https://docs.github.com/en/rest)

## Claude Code向けのヒント

- このプロジェクトは**パフォーマンス最優先**です
- 変更時は必ず`PERFORMANCE.md`を確認してください
- ブラウザインスタンスの扱いに注意
- 並列処理を壊さないように
- Bunでのテストも忘れずに
