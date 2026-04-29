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

> **Phase 1 status:** 5 テーマ（`film` / `github` / `hatena` / `sepia` / `mono`）を
> 実装済み。デフォルトは `film`。`accent` の自動切り替えは `theme=film` のときだけ
> `source` を見る形で動く（`source=github`→くすんだ緑、`source=hatena`→くすんだ青）。
> 他のテーマはテーマ自身の配色を優先し、source による accent 切り替えは行わない。
> 明示的な `accent` パラメータは Phase 1 では入れない（Phase 3 で再検討）。

- `theme`: `film`, `github`, `hatena`, `sepia`, `mono`（実装済み・デフォルト `film`）
- `accent`: `theme=film` のときのみ `source` で自動切り替え。明示指定は将来検討
- `background`: theme で自動決定。明示指定は将来検討
- `ink`: 文字と線の色。theme で自動決定

例:

- `/image?user=kako-jun&source=github&theme=film` — film 配色 + GitHub 緑のアクセント
- `/image?user=kako-jun&source=github&theme=github` — GitHub 草配色（accent 固定）
- `/image?user=kako-jun&source=hatena&theme=film` — film 配色 + はてな青のアクセント

## Core Modes

### 1. Kira Screen

- `曜日 x 時刻 x 活動量` の 3D 表示
- ただの棒グラフではなく、**面 / ワイヤー / 発光エッジ** を優先
- 画面の最初に出る「全体像」
- カメラは自動回転し、偏りを見せる

> **Phase 2 status:** 実装済み。半透明のハイトフィールドサーフェス
> （`MeshStandardMaterial`）にワイヤーフレームを重ね、`count` が
> ピーク帯（しきい値: max の 70%）に該当するセルだけ `highlight` 色の
> 垂直発光ラインを立てる。カメラは calm な低速自動回転（angle += 0.002）。

### 2. Month View

- 1か月の活動をカレンダーとして俯瞰
- ただし GitHub 草の模倣にはせず、各日セル内に「時刻帯」を感じさせる
- 3D から週次分析へ降りていく途中のブリッジ

> **Phase 3 status:** 実装済み。直近 ~30 日（最大 6 週 × 7 列）を Sun..Sat
> グリッドで配置し、各セルの濃度で日量、セル内右側の 24 本 vertical strip で
> 時刻帯の偏りを表現。日量は `grid → accent` の lerp、時刻帯ストリップは
> `accent → highlight` の lerp で色味が決まる。カメラは静止。

### 3. Weekly Overlay

- 1週間の `7 x 24` 時間グリッドを、週ごとに半透明レイヤーとして重ねる
- 同じ時間帯に活動が集まるほど濃度が上がる
- このモードが最も `L が偏りを読む` 感覚に近い
- MVP の主役はここ

> **Phase 3 status:** 実装済み。`step2.weeks` の最新 12 週を 400ms 間隔で
> 順に投入し、`aggregatedHours[7][24]` を更新するたび全セルの color/opacity
> を再計算する。正規化は全週投入後の最終 max を pre-compute して固定値で
> 行うため、累積で濃くなり続け、過去ピークが新ピーク登場で薄まらない。
> `accent → highlight` の lerp で色、累積で透明度が上がる構造。

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

- Endpoint: `/image`
- Return: `image/webp`
- 中身は animated WebP
- UI は含まない
- ただ表示するだけで成立する必要がある

想定パラメータ:

- `user`
- `source=github|hatena`
- `theme=film|github|hatena|sepia|mono`（Phase 1 で実装済み、デフォルト `film`）
- `size=small|medium|large`
- `mode=auto`
- `loop=true`

実装候補:

- `Hono` on Cloudflare Workers
- キャプチャや重い生成が Worker 単体で厳しい場合は、Cloudflare 前段 + 別生成ワーカーの分離を検討する

### B. Single-view export

`/api/frame` は廃止。単一ビューが必要な場合は `/image` に `view` を渡す。

- Endpoint: `/image?view=kira|month|week`
- Return: `image/webp`
- 単一状態を返す

想定パラメータ:

- `view=kira|month|week`
- `theme=...`

### C. iframe App

対話的埋め込み。

- Endpoint 例: `/viewer?user=...`
- 自動再生あり
- 下部にカルーセルの丸を表示
- 自動遷移も手動選択も可能
- クリックで特定モード固定も可能

iframe 用 UI:

- 3 つの丸: `kira`, `month`, `week`
- 現在位置だけ少し濃くする
- UI は小さく、主役を奪わない

実装候補:

- `Hono` で HTML を返すシンプルな構成
- フロントは素の `HTML/CSS/JS` + `Three.js`
- Next.js は採用しない

> **Phase 4 status:** 実装済み。`embed.html` は `<img id="kira-image">` に
> `/image` を読み込ませる。`view=auto` のときは viewer 側がクライアントサイドで
> 単一ビュー WebP（kira / month / week）をサイクル時間ごとに `<img>.src` ごと swap し、
> ドットと画像を完全同期させる（`performance.now()` 起点 RAF ループ + fade swap）。
> `view=kira|month|week` のときは単一ビュー WebP を表示し、該当ドットだけ active になる。
> ドットクリックは auto 同期を停止し、CSS opacity フェード（400ms ease-in-out）で
> 単一ビュー WebP に切り替わる。読み込み待ちを隠すため、3 つの単一ビュー（kira +
> month + week）を初期 load 時に並列 pre-warm する（`auto` は viewer 側で使わないので除外）。

> **Phase 5 status:** 実装済み。`/image?view=auto` は sharp で
> kira / month / week の 3 フレームをそれぞれ静止 WebP に encode したあと、
> `node-webpmux` で VP8X + ANIM + ANMF×3 の真の animated WebP コンテナに
> muxing する。sharp 単体では静止フレーム配列から animated WebP を生成
> できない（animated 出力は既に animated な入力の再エンコードのみ対応）ため
> muxer を分離している。per-frame `delay` は embed 側の `VIEW_DELAYS` と一致
> （`[4000, 2500, 5000]` ms）、`loops: 0` で無限ループ。単一ビューエクスポート
> （`view=kira|month|week`）は引き続き静止 WebP。embed.html の単一ビュー swap
> 同期ロジックは Phase 4 のまま維持しており、animated WebP は GitHub プロフィール
> / README 配置用の正本として機能する。

## Information Architecture

### Minimum viable experience

最初に出すべきもの:

- `/image` が **本当に animated WebP を返す**
- ループは `3D -> month -> week`
- `theme=film` が完成している
- `source=github|hatena` でアクセント色が変わる

### Phase 2

- iframe 埋め込み
- カルーセル UI
- 手動切り替え
- モード固定 URL

> Phase 4 で完了。`/viewer` が `/image` 駆動の対話的カルーセルとして動く。

### Phase 3

- カスタム配色
- JSON 入力
- 他サービス入力

> **Phase 6 status:** 「他サービス入力」のうち RSS/Atom/RDF 系は実装済み。
> `source=rss&feed=URL` で任意のフィードを読み、各 entry/item を
> `{ type:'article', date, title, url }` に正規化して既存の data-processor に
> そのまま流し込む。Atom は `published > updated`、RSS 2.0 は
> `pubDate > dc:date`、RDF は `dc:date > pubDate` の優先順で日付を抽出する。
> 視覚化レイヤー（graph.html / data-processor.js）にソース固有ロジックは入っていない。
>
> **Limitation:** ほとんどのサービスはフィードに直近 10〜50 件しか含めない。
> week ビューの累積は当然この範囲に閉じるため、長期の繰り返し bias を読むツール
> ではなく、**直近の posting-time bias を眺めるツール**として捉えるのが正しい。
> `feed` の SHA-256 ハッシュ（base64url 先頭 16 文字）を `/image` のキャッシュキー
> に使い、`source=rss` ではキャッシュキーから `user`（表示ラベル）を除外する。
> カスタム配色 / JSON 入力は Phase 6 のスコープ外。
>
> **Security:** `source=rss` の `feed` は private / loopback / link-local /
> metadata IP に解決されるホストへの接続を拒否（SSRF 対策）し、リダイレクト先も
> 再検証する。`<!DOCTYPE>` / `<!ENTITY>` を含む body は xml2js に渡す前に reject
> する（XXE / billion-laughs 対策）。URL 長は 1024 文字、フェッチサイズは 5 MB
> 上限。`/viewer` の 3 ビュー pre-warm は in-flight Map で 1 fetch に集約。

## Rendering Notes

`/image` は Phase 5 で真の animated WebP に対応済み。`view=auto`（デフォルト）は
sharp で各フレームを静止 WebP に encode したあと、node-webpmux で kira / month / week
の 3 フレームを 1 枚の animated WebP（VP8X + ANIM + ANMF×3）に muxing して返す。
per-frame delay は embed の VIEW_DELAYS と揃えている。node-webpmux は JS +
WebAssembly 実装でネイティブビルド依存はないが、ライセンスは LGPL-3.0-or-later
の点に注意（kira-activity 自身は MIT）。

優先順位:

1. ~~真の animated WebP 化~~（Phase 5 完了: sharp で frame encode + node-webpmux で muxing）
2. ~~`kira` ビューを Kira Screen として再設計~~（Phase 2 完了: surface + wireframe + peak edge）
3. ~~`week` ビューを Weekly Overlay 主役の見た目に再設計~~（Phase 3 完了: 7×24 累積オーバーレイ）
4. ~~`month` ビューを Month View として再定義~~（Phase 3 完了: Sun..Sat カレンダー + per-cell 24h strip）
5. ~~ソース層を provider registry に統合~~（Phase 7 完了: `services/registry.js` に
   `github` / `hatena` / `rss` を共通 contract で登録。ルート / レンダラから source 別
   分岐が消え、新 source は registry に 1 エントリで足せる。in-flight dedup も registry
   に集約され、全 source で `(source, user, feed)` 単位に効く）

### Cloudflare hosting note

sharp / libvips はネイティブ依存（C++ + libvips バイナリ）のため Cloudflare Workers では
動作不可。Cloudflare へ移すなら、Pages + 別 Worker 構成にし、画像生成は別の
microservice（Node ランタイム or Workers Containers）に切り出す必要がある。これは
Phase 5 のスコープ外で、別フェーズとして検討する。

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
