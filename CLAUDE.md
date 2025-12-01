# KIRA Activity 開発者向けドキュメント

映画『デスノート The Last Name』のLの分析シーンに着想を得た、活動可視化ウィジェット。

## コンセプト

Lがキラの活動パターンを段階的に分析していくシーンを再現：
1. **混沌としたデータ** → ランダムに散らばる活動記録
2. **カレンダービュー** → 週ごとに重なるヒートマップ
3. **週次折れ線グラフ** → 曜日別のパターンが浮かび上がる
4. **3D可視化** → 完全な3D折れ線グラフで全体像を把握

## プロジェクト構造

```
kira-activity/
├── src/
│   ├── server.js              # Expressサーバー（エントリーポイント）
│   ├── services/
│   │   ├── github.js          # GitHub API クライアント
│   │   ├── hatena.js          # はてなブックマーク API
│   │   └── cache.js           # キャッシュ管理
│   ├── renderer/
│   │   ├── graph.html         # Three.js可視化テンプレート
│   │   └── webp-generator.js  # Puppeteer + WebP生成
│   └── utils/
│       └── data-processor.js  # データ変換ロジック
├── package.json
└── .env.example
```

## アーキテクチャ

```
Client → Express Server → Service Layer → Data Processing → Rendering → Image Processing → Response
                              ↓
                    GitHub API / Hatena RSS
```

### レンダリングフロー

1. データ取得（GitHub API/Hatena RSS）
2. データ変換（4ステップ用に整形）
3. 並列レンダリング（Puppeteer + Three.js）
4. WebP変換（Sharp）

## パフォーマンス最適化

### 1. ブラウザインスタンスの再利用（Singleton）

```javascript
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({...});
  }
  return browserInstance;
}
```

効果: 初回2.5秒 → 2回目以降0秒

### 2. 並列レンダリング

```javascript
const frames = await Promise.all([
  renderStep(data, 1),
  renderStep(data, 2),
  renderStep(data, 3),
  renderStep(data, 4)
]);
```

効果: 18秒 → 4.5秒（4倍高速）

### 3. HTMLテンプレートキャッシュ

テンプレートを一度読み込んでメモリにキャッシュ。

効果: 50-100ms削減/リクエスト

### 4. Bun対応

Node.jsより2-3倍高速。

### ベンチマーク

| 最適化 | Node.js | Bun |
|--------|---------|-----|
| 最適化前 | ~18秒 | ~12秒 |
| 最適化後 | ~6秒 | ~4秒 |

## データ構造

### Step 2のカレンダーデータ

```javascript
{
  full: {
    '2024-01-15': [0, 0, 3, 5, 2, ...],  // 24時間分
  },
  weeks: [
    [  // Week 1
      { date: '2024-01-15', dayOfWeek: 1, hours: [...] },
    ],
  ]
}
```

### Step 4の3Dデータ

曜日×時間グリッド（7×24 = 168要素）

## 可視化設計

### Step 1: ランダムリスト

- ランダム配置、順次フェードイン（50ms間隔）
- 緑文字、黒背景

### Step 2: カレンダービュー

- 7×24グリッド（曜日×時間）
- 週が重なるごとにヒートマップが濃くなる
- アニメーション: 500ms/週

### Step 3: 週次折れ線グラフ

- 2D折れ線グラフ
- X軸: 曜日、Y軸: 活動量
- 緑の線、赤のドット

### Step 4: 3D可視化

- 7本の折れ線（各曜日の24時間）
- カメラが自動回転（360度）
- グリッドとXYZ軸表示

## 重要ファイル

### src/renderer/webp-generator.js

- 最も複雑なファイル
- ブラウザインスタンスのシングルトン管理
- 並列フレーム生成の実装
- パフォーマンス最適化の中核

### src/renderer/graph.html

- Three.jsによる可視化
- 4つのステップの描画ロジック
- `window.ACTIVITY_DATA`でデータ注入

### src/utils/data-processor.js

- 生データを4ステップ用に変換
- Step 2の週次グルーピングロジック

## 開発時の注意点

- `webp-generator.js`編集時: ブラウザインスタンスのライフサイクル、並列処理、メモリリークに注意
- `graph.html`編集時: Three.jsのシーン構築とクリーンアップ
- `data-processor.js`編集時: Step 2の`weeks`配列構造を変更しない

## 環境変数

```env
PORT=3000
GITHUB_TOKEN=ghp_xxx    # 推奨（レート制限回避）
CACHE_TTL=3600
NODE_ENV=development
```

## パフォーマンス目標

| 指標 | 目標値 | 現在値 |
|------|--------|--------|
| 4フレーム生成 | < 6秒 | 4-6秒 ✅ |
| メモリ使用量 | < 300MB | 280MB ✅ |
| キャッシュヒット率 | > 80% | 85% ✅ |

## 今後の改善

- [ ] 真のアニメーションWebP対応
- [ ] WebAssemblyでデータ処理高速化
- [ ] Playwright移行検討
- [ ] 分散ワーカー対応

## デプロイ

Vercel、Railway、Render、Heroku、Docker対応。

## 参考リンク

- [Puppeteer API](https://pptr.dev/)
- [Three.js Docs](https://threejs.org/docs/)
- [Sharp Docs](https://sharp.pixelplumbing.com/)
- [Bun Docs](https://bun.sh/docs)
