# KIRA Activity - TODO リスト

## 現在の状態

✅ 基本機能実装完了
✅ パフォーマンス最適化完了（3-4倍高速化）
✅ Bun対応完了
✅ ドキュメント整備完了

## 優先度: 高 🔴

### 1. 真のアニメーションWebP対応

**現状**: Step 4の静止画のみ返している
**目標**: 4ステップのアニメーションWebPを生成

**実装方法**:

#### Option A: ffmpeg経由
```javascript
import ffmpeg from 'fluent-ffmpeg';

async function createAnimatedWebP(frames, delays) {
  // PNG → WebP frames
  for (let i = 0; i < frames.length; i++) {
    await sharp(frames[i]).toFile(`frame-${i}.png`);
  }

  // ffmpegでアニメーション化
  await ffmpeg()
    .input('frame-%d.png')
    .inputFPS(1000 / delays[0])
    .outputOptions([
      '-loop 0',
      '-vcodec libwebp',
      '-lossless 0',
      '-compression_level 6',
      '-q:v 80'
    ])
    .output('animated.webp')
    .run();

  return readFileSync('animated.webp');
}
```

**必要な依存関係**:
```json
{
  "fluent-ffmpeg": "^2.1.2"
}
```

**システム要件**: ffmpegのインストール

#### Option B: libwebpバインディング
```javascript
import { WebPAnimEncoder } from 'node-webpmux';

async function createAnimatedWebP(frames, delays) {
  const encoder = new WebPAnimEncoder();

  for (let i = 0; i < frames.length; i++) {
    const webp = await sharp(frames[i]).webp().toBuffer();
    encoder.addFrame(webp, delays[i]);
  }

  return encoder.encode();
}
```

**タスク**:
- [ ] ffmpeg or libwebpを選択
- [ ] 実装
- [ ] テスト（アニメーション動作確認）
- [ ] パフォーマンス測定
- [ ] ドキュメント更新

**期待効果**:
- GitHubのREADMEで動くアニメーション
- ファイルサイズ削減（4画像 → 1アニメーション）

---

### 2. エラーハンドリング改善

**現状**: 基本的なエラーハンドリングのみ
**目標**: 堅牢なエラーリカバリー

**実装**:
```javascript
// src/utils/error-handler.js
export class APIError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

// src/services/github.js
async getUserEvents(username, pages = 3) {
  try {
    // ...
  } catch (error) {
    if (error.response?.status === 404) {
      throw new APIError(
        `User "${username}" not found`,
        404,
        { username, source: 'github' }
      );
    } else if (error.response?.status === 403) {
      throw new APIError(
        'GitHub API rate limit exceeded',
        429,
        { resetAt: error.response.headers['x-ratelimit-reset'] }
      );
    }
    throw new APIError('GitHub API error', 500, { original: error.message });
  }
}
```

**タスク**:
- [ ] カスタムエラークラス作成
- [ ] レート制限の詳細情報を返す
- [ ] リトライロジック実装
- [ ] エラーログ改善
- [ ] ユーザーフレンドリーなエラーメッセージ

---

### 3. レート制限対策

**現状**: レート制限なし
**目標**: DoS攻撃対策 + GitHub APIレート制限管理

**実装**:
```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 100, // 100リクエスト/15分
  message: { error: 'Too many requests, please try again later' }
});

app.use('/api/', limiter);

// GitHub APIレート制限チェック
async function checkRateLimit() {
  const response = await client.get('/rate_limit');
  const remaining = response.data.rate.remaining;
  const reset = response.data.rate.reset;

  if (remaining < 10) {
    console.warn(`⚠️  GitHub API rate limit low: ${remaining}`);
  }

  return { remaining, reset };
}
```

**タスク**:
- [ ] express-rate-limit導入
- [ ] GitHub APIレート制限チェック
- [ ] レート制限情報をログに記録
- [ ] レート制限エラー時の適切なレスポンス

---

## 優先度: 中 🟡

### 4. キャッシュ改善

**現状**: メモリキャッシュのみ（再起動で消える）
**目標**: 永続化キャッシュ + Redis対応

**実装**:
```javascript
// Option A: ファイルベース
import NodeCache from 'node-cache';
import fs from 'fs/promises';

class PersistentCache extends NodeCache {
  constructor() {
    super({ stdTTL: 3600 });
    this.loadFromDisk();
  }

  async loadFromDisk() {
    try {
      const data = await fs.readFile('.cache/data.json');
      const cache = JSON.parse(data);
      Object.entries(cache).forEach(([key, value]) => {
        this.set(key, value);
      });
    } catch (error) {
      // No cache file
    }
  }

  async saveToDisk() {
    const cache = {};
    this.keys().forEach(key => {
      cache[key] = this.get(key);
    });
    await fs.writeFile('.cache/data.json', JSON.stringify(cache));
  }
}

// Option B: Redis
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

async function getCached(key) {
  const cached = await redis.getBuffer(key);
  return cached;
}

async function setCached(key, buffer, ttl = 3600) {
  await redis.setex(key, ttl, buffer);
}
```

**タスク**:
- [ ] ファイルベースキャッシュ実装
- [ ] Redis対応（オプション）
- [ ] キャッシュ統計API（ヒット率など）
- [ ] キャッシュクリア機能

---

### 5. Playwright移行検討

**現状**: Puppeteer使用
**目標**: より高速なPlaywright

**利点**:
- 起動が30%高速
- メモリ使用量が少ない
- マルチブラウザ対応

**実装**:
```javascript
import { chromium } from 'playwright';

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
  }
  return browserInstance;
}
```

**タスク**:
- [ ] Playwright検証
- [ ] パフォーマンス比較
- [ ] 移行実装
- [ ] テスト

---

### 6. テストの追加

**現状**: テストなし
**目標**: 最低限のテストカバレッジ

**実装**:
```javascript
// test/data-processor.test.js
import { describe, it, expect } from 'bun:test';
import { DataProcessor } from '../src/utils/data-processor.js';

describe('DataProcessor', () => {
  it('should generate random list', () => {
    const events = [/* mock data */];
    const result = DataProcessor.generateRandomList(events);
    expect(result).toHaveLength(50);
  });

  it('should generate calendar view', () => {
    const events = [/* mock data */];
    const result = DataProcessor.generateCalendarView(events);
    expect(result.weeks).toBeArray();
    expect(result.full).toBeObject();
  });
});

// test/api.test.js
describe('API Endpoints', () => {
  it('GET /api/graph should return WebP', async () => {
    const response = await fetch('http://localhost:3000/api/graph?user=test');
    expect(response.headers.get('content-type')).toBe('image/webp');
  });
});
```

**タスク**:
- [ ] Bunテストセットアップ
- [ ] DataProcessorのユニットテスト
- [ ] API統合テスト
- [ ] E2Eテスト（オプション）

---

### 7. CI/CD パイプライン

**現状**: 手動デプロイ
**目標**: 自動テスト + デプロイ

**実装**:
```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - uses: superfly/flyctl-actions@v1
        with:
          args: "deploy"
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

**タスク**:
- [ ] GitHub Actionsセットアップ
- [ ] テスト自動化
- [ ] デプロイ自動化（Vercel/Fly.io/Railway）

---

## 優先度: 低 🟢

### 8. WebAssembly化（データ処理高速化）

**現状**: JavaScript実装
**目標**: WASM化で10倍高速化

**実装**:
```rust
// data-processor/src/lib.rs
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct ProcessedData {
    step1: Vec<Activity>,
    step2: CalendarView,
    step3: WeeklyView,
    step4: Grid3D,
}

#[wasm_bindgen]
pub fn process(events: JsValue) -> ProcessedData {
    let events: Vec<Event> = events.into_serde().unwrap();

    ProcessedData {
        step1: generate_random_list(&events),
        step2: generate_calendar_view(&events),
        step3: generate_weekly_view(&events),
        step4: generate_3d_view(&events),
    }
}
```

**タスク**:
- [ ] Rustプロジェクトセットアップ
- [ ] データ処理ロジックの移植
- [ ] WASMビルド
- [ ] パフォーマンス測定
- [ ] 統合

---

### 9. GPU活用（3D描画高速化）

**現状**: CPU描画のみ
**目標**: GPU活用で2-3倍高速化

**実装**:
```javascript
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--enable-gpu',
    '--use-gl=desktop',
    '--enable-webgl',
    '--ignore-gpu-blacklist'
  ]
});
```

**タスク**:
- [ ] GPU有効化テスト
- [ ] パフォーマンス測定
- [ ] 環境別の挙動確認

---

### 10. 多言語対応

**現状**: 英語のみ
**目標**: 日本語対応

**実装**:
```javascript
const i18n = {
  en: {
    analyzing: 'ANALYZING PATTERN...',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  },
  ja: {
    analyzing: 'パターンを分析中...',
    weekdays: ['日', '月', '火', '水', '木', '金', '土']
  }
};
```

**タスク**:
- [ ] i18nライブラリ導入
- [ ] 翻訳ファイル作成
- [ ] graph.htmlの多言語化

---

### 11. その他のデータソース対応

**候補**:
- GitLab
- Bitbucket
- Qiita
- Zenn
- note
- Twitter/X

**実装**:
```javascript
// src/services/gitlab.js
export class GitLabClient {
  async getComprehensiveActivity(username) {
    // GitLab API実装
  }
}
```

---

### 12. カスタムテーマ

**現状**: Death Noteテーマのみ
**目標**: 複数テーマ対応

**候補**:
- Matrix風（緑文字、黒背景） ← 現在のデフォルト
- サイバーパンク風（青/ピンク、グリッチエフェクト）
- ミニマル風（白背景、黒文字）
- ダークモード風（グレー基調）

**実装**:
```javascript
const themes = {
  deathnote: {
    bg: '#000',
    text: '#0f0',
    accent: '#f00'
  },
  cyberpunk: {
    bg: '#0a0e27',
    text: '#00d9ff',
    accent: '#ff007f'
  },
  minimal: {
    bg: '#fff',
    text: '#000',
    accent: '#666'
  }
};
```

---

## バグ・課題

### 既知の問題

1. **アニメーションWebP未対応**
   - 現在はStep 4の静止画のみ
   - Priority: 高

2. **週次カレンダーのアニメーション待ち時間**
   - Step 2で週が重なるアニメーションに時間がかかる
   - 解決策: タイムアウト調整 or スキップ可能に

3. **メモリリークの可能性**
   - 長時間稼働時のメモリ使用量を監視
   - 解決策: 定期的なブラウザ再起動

---

## 完了したタスク ✅

- [x] 基本実装
- [x] GitHub API対応
- [x] はてなブックマーク対応
- [x] 4ステップ可視化
- [x] ブラウザインスタンス再利用
- [x] 並列フレーム生成
- [x] HTMLテンプレートキャッシュ
- [x] Bun対応
- [x] README作成
- [x] PERFORMANCE.md作成
- [x] .claude/ ドキュメント整備

---

## 参考リンク

- [ffmpeg WebP options](https://ffmpeg.org/ffmpeg-formats.html#webp)
- [node-webpmux](https://github.com/Kagami/node-webpmux)
- [Playwright API](https://playwright.dev/docs/api/class-playwright)
- [Bun Test](https://bun.sh/docs/cli/test)

---

最終更新: 2025-11-17
