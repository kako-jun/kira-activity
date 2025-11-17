# KIRA Activity - 設計ドキュメント

## 設計思想

### コンセプト

映画『デスノート The Last Name』でLがキラの活動パターンを分析するシーンをプログラマティックに再現。
単なる活動グラフではなく、**分析プロセスの可視化**を目指す。

### デザイン哲学

1. **段階的理解**: データを4段階で整理し、パターンを浮かび上がらせる
2. **視覚的インパクト**: Death Noteらしい黒/緑/赤の配色
3. **パフォーマンス**: 3-4秒でレンダリング完了（Bun使用時）
4. **シンプルAPI**: 画像URLを貼るだけで動作

## アーキテクチャ設計

### レイヤー構造

```
┌─────────────────────────────────────┐
│     User (GitHub README, etc.)      │
└──────────────┬──────────────────────┘
               │ HTTP Request
               ▼
┌─────────────────────────────────────┐
│      Express API Server             │
│  - /api/graph                       │
│  - /api/frame                       │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
   ┌─────────┐   ┌─────────┐
   │ Cache   │   │ Data    │
   │ Manager │   │ Fetcher │
   └─────────┘   └────┬────┘
                      │
              ┌───────┴────────┐
              ▼                ▼
         ┌─────────┐      ┌──────────┐
         │ GitHub  │      │  Hatena  │
         │   API   │      │    RSS   │
         └─────────┘      └──────────┘
               │
               ▼
        ┌──────────────┐
        │    Data      │
        │  Processor   │
        └──────┬───────┘
               │
               ▼
        ┌──────────────┐
        │   Puppeteer  │
        │  (Singleton) │
        └──────┬───────┘
               │
          ┌────┴────┐
          ▼         ▼
     ┌────────┐ ┌────────┐
     │ Page 1 │ │ Page 2 │  (並列実行)
     └────┬───┘ └────┬───┘
          │         │
          ▼         ▼
     ┌─────────────────┐
     │   Three.js      │
     │  Rendering      │
     └────────┬────────┘
              │
              ▼
     ┌─────────────────┐
     │     Sharp       │
     │  (WebP 変換)     │
     └────────┬────────┘
              │
              ▼
         WebP Buffer
```

## データフロー

### 1. データ取得フェーズ

```
User Request
    │
    ├─> GitHub API
    │   ├─> /users/{user}/events/public (最新300件)
    │   └─> /repos/{user}/{repo}/commits (各リポジトリ)
    │
    ├─> Hatena Bookmark API
    │   └─> /{user}/rss (最新200件)
    │
    └─> 統合
        └─> { username, totalActivity, events[], fetchedAt }
```

### 2. データ変換フェーズ

```
Raw Activity Data
    │
    ├─> Step 1: generateRandomList()
    │   └─> ランダムに並び替え、50件抽出
    │
    ├─> Step 2: generateCalendarView()
    │   └─> 日付×時間マトリックス + 週次グループ化
    │
    ├─> Step 3: generateWeeklyView()
    │   └─> 曜日別集計（7要素配列）
    │
    └─> Step 4: generate3DView()
        └─> 曜日×時間グリッド（7×24 = 168要素）
```

### 3. レンダリングフェーズ

```
Processed Data
    │
    ├─> Browser Instance (再利用)
    │   │
    │   ├─> Page 1: Step 1 ─┐
    │   ├─> Page 2: Step 2  ├─> Promise.all() (並列)
    │   ├─> Page 3: Step 3  │
    │   └─> Page 4: Step 4 ─┘
    │
    └─> 4 PNG Buffers
        │
        ├─> Sharp (並列変換)
        │
        └─> 4 WebP Buffers
            │
            └─> Return: Step 4 WebP (現在)
                        ※将来: アニメーションWebP
```

## 可視化設計

### Step 1: ランダムリスト（混沌）

**目的**: 生データの未整理状態を表現

```html
<div class="random-item" style="
  position: absolute;
  left: random(0-80%);
  top: random(0-80%);
  opacity: 0 → 1 (fade in)
">
  2024-01-15 12:34 - repository-name
</div>
```

**デザイン**:
- ランダムな配置
- 順次フェードイン（50ms間隔）
- 緑文字、黒背景

### Step 2: カレンダービュー（パターン認識開始）

**目的**: 週ごとのデータが重なり、ヒートマップが形成される

```javascript
// 週ごとにレイヤーを追加
weeks.forEach((week, weekIndex) => {
  setTimeout(() => {
    week.forEach(day => {
      // 既存のマスを更新（色が濃くなる）
      aggregatedCount += newCount;
      color = HSL(0.3, 1, 0.2 + intensity * 0.6);
    });
  }, weekIndex * 500);
});
```

**特徴**:
- 7×24のグリッド（曜日×時間）
- 週が重なるごとにヒートマップが濃くなる
- アニメーション: 500ms/週

### Step 3: 週次折れ線グラフ（傾向の発見）

**目的**: 曜日別のパターンを明確化

```javascript
// 7つの点を線で結ぶ
points = [Sun, Mon, Tue, Wed, Thu, Fri, Sat];
line = new THREE.Line(geometry, material);
```

**特徴**:
- 2D折れ線グラフ
- X軸: 曜日
- Y軸: 活動量
- 緑の線、赤のドット

### Step 4: 3D可視化（完全な理解）

**目的**: 全体像の把握（時間×曜日×活動量）

```javascript
// 7本の折れ線（各曜日の24時間）
dayGroups.forEach((dayCells, dayIndex) => {
  points = dayCells.map(cell => {
    return new Vector3(
      cell.hour - 12,        // X: 時間
      cell.count / max * 5,  // Y: 活動量
      dayIndex - 3           // Z: 曜日
    );
  });

  line = new THREE.Line(points);
  scene.add(line);
});

// カメラ回転
camera.position = rotate(15, 10, 15);
```

**特徴**:
- 7色の折れ線（各曜日）
- カメラが自動回転（360度）
- グリッドとXYZ軸表示

## パフォーマンス設計

### 最適化戦略

#### 1. ブラウザインスタンスの再利用

**問題**: Puppeteerの起動に2-3秒かかる

**解決策**:
```javascript
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({...});
  }
  return browserInstance;
}
```

**効果**:
- 初回: 2.5秒
- 2回目以降: 0秒（即座）

#### 2. 並列レンダリング

**問題**: 4ステップを順次実行すると18秒かかる

**解決策**:
```javascript
const frames = await Promise.all([
  renderStep(data, 1),
  renderStep(data, 2),
  renderStep(data, 3),
  renderStep(data, 4)
]);
```

**効果**: 18秒 → 4.5秒（4倍高速）

#### 3. HTMLテンプレートキャッシュ

**問題**: 毎回ファイルI/Oが発生

**解決策**:
```javascript
let htmlTemplate = null;

function getHTMLTemplate() {
  if (!htmlTemplate) {
    htmlTemplate = readFileSync('graph.html');
  }
  return htmlTemplate;
}
```

**効果**: 50-100ms削減/リクエスト

#### 4. キャッシュ戦略

```javascript
cache.set(`graph_${source}_${user}_${style}`, buffer, TTL=3600);

// 2回目以降
if (cached) {
  return cached; // 即座にレスポンス
}
```

**効果**:
- キャッシュヒット時: < 10ms
- キャッシュミス時: 4-6秒

## API設計

### RESTful API

#### GET /api/graph

アニメーションWebP（将来的に）を生成。現在はStep 4の静止画。

**パラメータ**:
- `user` (required): ユーザー名
- `source` (optional): `github` | `hatena` (default: `github`)
- `style` (optional): `deathnote` (default: `deathnote`)
- `size` (optional): `small` | `medium` | `large` (default: `medium`)

**レスポンス**:
- Content-Type: `image/webp`
- Cache-Control: `public, max-age=3600`

#### GET /api/frame

特定ステップの静止画を生成。

**パラメータ**:
- `user` (required): ユーザー名
- `source` (optional): `github` | `hatena`
- `step` (optional): `1` | `2` | `3` | `4` (default: `4`)
- `style` (optional): `deathnote`

**レスポンス**:
- Content-Type: `image/webp`

## エラーハンドリング

### エラー種別

1. **ユーザーが見つからない**
   ```json
   { "error": "User 'xxx' not found on GitHub" }
   ```

2. **レート制限**
   ```json
   { "error": "GitHub API rate limit exceeded" }
   ```

3. **レンダリング失敗**
   ```json
   { "error": "Failed to generate graph", "details": "..." }
   ```

### リトライ戦略

- GitHub API: 指数バックオフ（1s, 2s, 4s）
- Puppeteer: 1回のみリトライ
- Sharp: リトライなし（即座にエラー）

## セキュリティ考慮

### 入力検証

```javascript
// ユーザー名のサニタイズ
const username = req.query.user.replace(/[^a-zA-Z0-9-_]/g, '');

// SQLインジェクション対策（該当なし - DB不使用）
// XSS対策（該当なし - 画像レスポンスのみ）
```

### レート制限

```javascript
// TODO: express-rate-limit導入
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 100 // 100リクエスト
});
```

### 環境変数

- `GITHUB_TOKEN`: .envファイルで管理
- .gitignoreに追加済み

## スケーラビリティ

### 水平スケーリング

```
Load Balancer
    │
    ├─> Server 1 (Browser Pool)
    ├─> Server 2 (Browser Pool)
    └─> Server 3 (Browser Pool)
        │
        └─> Redis (共有キャッシュ)
```

### 垂直スケーリング

- CPU: 4コア → 8コア（並列処理が加速）
- メモリ: 2GB → 4GB（ブラウザプール拡大）

## 今後の設計改善

### Phase 2: 真のアニメーション

```javascript
// ffmpegでアニメーションWebP生成
const frames = [...];
await ffmpeg()
  .input('frame-%d.png')
  .outputOptions('-loop', '0')
  .output('animated.webp');
```

### Phase 3: WebAssembly化

```rust
// data-processor.rsをWASMにコンパイル
#[wasm_bindgen]
pub fn process_activity_data(events: Vec<Event>) -> ProcessedData {
  // 10倍高速化
}
```

### Phase 4: Edge Functions

```typescript
// Cloudflare Workers
export default {
  async fetch(request) {
    // グローバル分散
    // レイテンシ < 100ms
  }
}
```

## まとめ

KIRA Activityは**パフォーマンス最優先**で設計されたウィジェットです：

- ✅ 並列処理で4倍高速化
- ✅ ブラウザ再利用で起動コスト削減
- ✅ キャッシュで2回目以降は即座
- ✅ Bunで2-3倍高速化

今後も**「速さ」**を重視しながら機能拡張していきます。
