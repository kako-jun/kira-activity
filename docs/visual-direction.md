# KIRA Activity Visual Direction

`kira-activity` は GitHub 草の亜種ではなく、映画『デスノート』実写版1作目の分析スクリーンに着想を得た「活動時間の偏り」を読むウィジェットである。

## Product Goal

- GitHub 個人ページや README に貼れる
- 最小構成は **画像 API**
- 返却形式は **animated WebP**
- ループ内容は **3D -> month -> week** の分析遷移
- 将来的には **iframe 埋め込み**も提供し、手動切り替え UI も持たせる
- 最終的なホスティング先は **Cloudflare**
- アプリ層は **Next.js ではなく Hono 系** を優先する

## Visual Direction

### Base theme

- 映画オマージュの基本配色を使う
- 背景は黒ではなく **クリーム色寄り**
- 線、文字、グリッドは **濃い灰色 / 茶色 / くすんだ青灰**
- 全体はハッカー風ではなく **捜査資料 / 分析モニタ** の温度感

### Accent strategy

- デフォルトは映画寄りの落ち着いた配色
- データソースに応じてアクセント色を切り替えられる
- `github`: 緑系
- `hatena`: 青系
- `custom`: 任意指定

### Parameterized palette

API では色指定を `theme` の単語だけで済ませず、最終的には次のような層に分ける。

- `theme`: `film`, `github`, `hatena`, `sepia`, `mono`
- `accent`: 自動または明示指定
- `background`: 自動または明示指定
- `ink`: 文字と線の色

例:

- `/api/graph?user=kako-jun&source=github&theme=film`
- `/api/graph?user=kako-jun&source=github&theme=github`
- `/api/graph?user=kako-jun&source=hatena&theme=film&accent=%233a6ea5`

## Core Modes

### 1. Kira Screen

- `曜日 x 時刻 x 活動量` の 3D 表示
- ただの棒グラフではなく、**面 / ワイヤー / 発光エッジ** を優先
- 画面の最初に出る「全体像」
- カメラは自動回転し、偏りを見せる

### 2. Month View

- 1か月の活動をカレンダーとして俯瞰
- ただし GitHub 草の模倣にはせず、各日セル内に「時刻帯」を感じさせる
- 3D から週次分析へ降りていく途中のブリッジ

### 3. Weekly Overlay

- 1週間の `7 x 24` 時間グリッドを、週ごとに半透明レイヤーとして重ねる
- 同じ時間帯に活動が集まるほど濃度が上がる
- このモードが最も `L が偏りを読む` 感覚に近い
- MVP の主役はここ

## Animation Direction

静止画の切り替えではなく、「分析が進む」流れを見せる。

1. `Kira Screen`
2. カメラが寄る / 軸が崩れる / 面が解ける
3. `Month View`
4. セルが再配置され、週の層に分解される
5. `Weekly Overlay`
6. 数秒停止
7. ループ

## Motion Principles

- アニメーションは **p5.js 的に気持ちよい補間** を目指す
- 機械的なフェードだけで終わらせない
- 推奨:
  - ease-in-out
  - 慣性のあるカメラ移動
  - ラインがほどけて再配置される morph
  - レイヤー追加時のわずかな残像

Three.js のままでもよいが、動きの考え方は p5 的な「美しい状態遷移」を採る。

## Output Modes

### A. Image API

GitHub のプロフィール右上や README に貼る主戦場。

- Endpoint: `/api/graph`
- Return: `image/webp`
- 中身は animated WebP
- UI は含まない
- ただ表示するだけで成立する必要がある

想定パラメータ:

- `user`
- `source=github|hatena`
- `theme=film|github|hatena|sepia|mono`
- `size=small|medium|large`
- `mode=auto`
- `loop=true`

実装候補:

- `Hono` on Cloudflare Workers
- キャプチャや重い生成が Worker 単体で厳しい場合は、Cloudflare 前段 + 別生成ワーカーの分離を検討する

### B. Single-view export

`/api/frame` は廃止。単一ビューが必要な場合は `/api/graph` に `view` を渡す。

- Endpoint: `/api/graph?view=kira|month|week`
- Return: `image/webp`
- 単一状態を返す

想定パラメータ:

- `view=kira|month|week`
- `theme=...`

### C. iframe App

将来の対話的埋め込み。

- Endpoint 例: `/embed?user=...`
- 自動再生あり
- 下部にカルーセルの丸を表示
- 自動遷移も手動選択も可能
- クリックで特定モード固定も可能

iframe 用 UI:

- 3 つの丸: `3D`, `Month`, `Week`
- 現在位置だけ少し濃くする
- UI は小さく、主役を奪わない

実装候補:

- `Hono` で HTML を返すシンプルな構成
- フロントは素の `HTML/CSS/JS` + `Three.js`
- Next.js は採用しない

## Information Architecture

### Minimum viable experience

最初に出すべきもの:

- `/api/graph` が **本当に animated WebP を返す**
- ループは `3D -> month -> week`
- `theme=film` が完成している
- `source=github|hatena` でアクセント色が変わる

### Phase 2

- iframe 埋め込み
- カルーセル UI
- 手動切り替え
- モード固定 URL

### Phase 3

- カスタム配色
- JSON 入力
- 他サービス入力

## Rendering Notes

現状の実装では `/api/graph` が実質 static WebP を返している。これは MVP 要件を満たしていないため、最優先で改める。

優先順位:

1. 真の animated WebP 化
2. `kira` ビューを Kira Screen として再設計
3. `week` ビューを Weekly Overlay 主役の見た目に再設計
4. `month` ビューを Month View として再定義

## Terminology

公開仕様（ルート、クエリ、ドキュメント）では次の語を使う。

- `kira`
- `month`
- `week`
- `auto`

内部の `step1..step4` / `scene1..scene4` は data-processor のキーや graph.html の関数名に
残るが、外には出さない。`random list`（旧 step1）は開発時の補助演出に留め、本番ループからは外す。

## Non-Goals

- GitHub 草クローンの色違い
- 棒グラフだけの無機質な 3D
- ネオングリーン一色のハッカー演出
- UI だらけの情報過多な埋め込み

## Design Sentence

GitHub grass shows consistency.  
KIRA Activity shows bias.
