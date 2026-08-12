# 自作 UI の接続仕様

O-S-C 本体を**無改造のままサーバー(OSC I/O + WebSocket + custom module ホスト)としてのみ使い**、
ブラウザ UI を自作 UI に差し替えるための接続仕様。

前提となる方針は `CLAUDE.md` の「絶対規律」と `DESIGN.md` を正とする。

## 1. 全体構成

```
自作 UI  --WebSocket-->  O-S-C サーバー  --UDP OSC-->  Unity
        <--WebSocket--  (custom module)  <--UDP OSC--
```

O-S-C サーバーは**レイアウト JSON を一切解釈しない**。読み込んでブラウザへ転送するだけで、
ウィジェットの概念はすべてクライアント側にある。したがって自作 UI 側は O-S-C のレイアウト形式に
従う必要が一切なく、独自のレイアウト表現を持ってよい。

## 2. サーバーの起動

```powershell
node vendor/open-stage-control/app -n --no-qrcode -p 7080 -o 7091 -c packages/custom-module/dist/osc-surface.js
```

| フラグ | 意味 |
|---|---|
| `-n` | 内蔵 GUI ウィンドウを開かない(headless) |
| `-p 7080` | HTTP / WebSocket のポート |
| `-o 7091` | OSC 受信ポート(Unity → サーフェス) |
| `-c <path>` | custom module |
| `--remote-root <dir>` | 静的ファイルの配信ルート(任意) |

### 自作 UI の静的配信(任意)

`--remote-root <dir>` を指定すると `http://<host>:7080/index.html` から `<dir>` 配下の
静的ファイルが配信される。プロセスもポートも増やさずに済む。

- `/`(ルート)は**常に内蔵 UI を返し、無効化できない**(`src/server/node/server.mjs`)。
  自作 UI の入口は `/index.html` など別パスになる
- 自前でサーバーを持つフレームワーク(NiceGUI 等)は、別ポートで動かしてよい

## 3. WebSocket プロトコル

### 接続 URL

```
ws://<host>:<port>/<clientId>/<auth>
```

- `clientId` は任意の一意文字列
- `auth` は Basic 認証(`--authentication`)を使う場合のみ。未使用なら空文字 = **末尾スラッシュで終わる**

### フレーム形式

すべて `["イベント名", データ]` の JSON 配列(`src/server/node/ipc/client.mjs`)。

| 方向 | フレーム | 説明 |
|---|---|---|
| C→S | `["open", {}]` | 接続直後に送る。`serverTargets` 等が返る |
| C→S | `["sendOsc", {…}]` | OSC 送信(下記) |
| S→C | `["receiveOsc", {address, args, host, port}]` | 受信した OSC。全クライアントにブロードキャスト |
| S→C | `["ping"]` | **死活監視。下記の注意を必ず読むこと** |
| C→S | `["pong"]` | `ping` への応答 |

### sendOsc のペイロード

```jsonc
["sendOsc", {
  "address": "/avatar/blend/smile",
  "v": 0.5,                       // 値(単一引数の場合)
  "preArgs": [],                  // 多引数の場合の前置分。args = preArgs.concat(v)
  "typeTags": "f",                // 1 引数 1 文字
  "target": ["127.0.0.1:7090"]    // 必須
}]
```

- **`target` は必須**。省略すると `if (data.target)` が false になり何も送信されない。
  起動時の `-s` によるサーバー既定 target も、この経路では適用されない
- 送信は custom module の `oscOutFilter` を通る(`/surface/*` はブロックされ、診断ログに記録される)

### 死活監視の注意(実装必須)

サーバーは 25 秒ごとに `["ping"]` を送り、**5 秒以内に `["pong"]` が返らないと接続を切る**
(`src/server/node/ipc/client.mjs`)。自作クライアントは必ず `ping` に応答すること。
短時間の PoC では顕在化しないため見落としやすい。

### 型情報の欠落

`receiveOsc` 経路では OSC の型タグが落ちる(`args[i].value` のみになり、
**引数が 1 個のときは配列も外れて素の値になる**)。型が必要な処理は custom module の
`oscInFilter` 側(型付きの生データが得られる)で行うこと。

### リファレンス実装

`tools/poc/poc-headless-ws.js` に、サーバー起動 → ws 接続 → `sendOsc` で UDP 到達 →
UDP 送信で `receiveOsc` 受信、までを 1 ファイルで通した実証コードがある。

```powershell
node tools/poc/poc-headless-ws.js
```

## 4. マニフェストの取得

custom module は `/sys/manifest` を `oscInFilter` で消費して `false` を返すため、生の
`/sys/manifest` は WebSocket クライアントに流れてこない。代わりに **採用済みマニフェストを
`/surface/manifest` として `receive()` で配る経路**を用意してある(`module-runtime.ts`)。

| 方向 | アドレス | 引数 | 説明 |
|---|---|---|---|
| S→C | `/surface/manifest` | マニフェスト JSON 文字列 1 個 | 採用時に全クライアントへ。`sessionOpened` では当該クライアントのみへ |
| C→S | `/surface/manifest/request` | (無視される。1 個以上必要) | 再配信要求。custom module 内で消費され UDP には出ない |

- 配るのは **zod 検証を通った後の正規化済み JSON**。誤接続ガード(`expectedProjectId`)で
  弾かれたマニフェストは配られない
- まだ 1 度もマニフェストを採用していないときは無応答。UI 側は届くまで要求を繰り返す
- **レイアウト JSON が無くても配られる**。O-S-C を `-l` 無しで起動した構成(自作 UI 専用)でも
  マニフェストは届く。`/EDIT` による内蔵 UI の動的生成だけがスキップされる

```jsonc
// C→S: 再配信要求(target は sendOsc の必須項目なので何か入れる)
["sendOsc", { "address": "/surface/manifest/request", "v": 1, "preArgs": [],
              "typeTags": "i", "target": ["127.0.0.1:7090"] }]

// S→C
["receiveOsc", { "address": "/surface/manifest",
                 "args": "{\"version\":1,\"projectId\":\"...\",\"entries\":[...]}" }]
```

値のエコーバック(エントリの `address` 宛)は内部名前空間ではないので、そのまま
`receiveOsc` として届く。

### 参照実装

`packages/nicegui-ui/` が NiceGUI(Python)による実装。`packages/nicegui-ui/README.md` を参照。

## 5. OSC ネイティブ UI を使う場合

TouchOSC / OSC/PILOT のような OSC を直接喋るアプリを UI にする場合、WebSocket は使わず
UDP で直結できるが、**転送役を custom module が担う必要がある**。

O-S-C は「OSC 受信 → ブラウザへ配る」しか行わず、OSC 受信を別の OSC 宛先へ転送する経路を
持たない(ブラウザ UI では各ウィジェットの `target` がその役を担っている)。

`config/surface.config.json` の `oscUi` ブロックで有効化する。

```jsonc
{
  "oscUi": {
    "enabled": true,
    "staticPeers": [],   // 名乗りを使わず固定配信する宛先
    "peerTtlMs": 0       // 名乗り登録の有効期限。0 は無期限
  }
}
```

### エコーバック宛先の登録

UDP には接続の概念がないため、サーフェス側が UI の IP と受信ポートを知る必要がある。
UI から起動時に名乗りを 1 発送る。

```
/surface/hello  <受信ポート:int>
```

引数を省略した場合は送信元ポートを宛先として使う。ルーティング判定は
`packages/custom-module/src/osc-ui-router.ts` にあり、以下の優先順位で行う。

1. 送信元が Unity(`host` + `sendPort` が一致)→ Unity のエコーバックとみなし、登録済み UI ピア全員へ配る
2. 送信元ホストが既知の UI ピア → UI 操作とみなし Unity へ転送する
3. それ以外 → 素性不明として捨てる

Unity 判定を先に置いているため、Unity と UI が同一ホストに同居していても正しく動く。
また操作が続いている間はピアの有効期限が自動延長されるので、UI 側に名乗りの定期送信を強制しない。

## 6. 自作 UI 側の設計上の注意

`CLAUDE.md` の絶対規律に従うこと。括弧内は NiceGUI 版での実装場所。

- **Unity が真実の源**。UI は表示キャッシュにすぎず、値の確定は Unity のエコーバックのみ
  (`value_store.py` の `on_echo`)
- 操作中は自分の値を表示し、指を離したらエコーバックを正とする調停が必要
  (`ValueChannel.holding`。離脱イベントを取りこぼしたときの保険として `page.py` に解除タイムアウト)
- 送信レートを間引く(毎フレーム OSC を飛ばさない)
  (`ValueChannel.on_local` で既定 30Hz。最後の値だけは必ず送る)
- 再接続時に状態を復元する
  (再接続で送信途中の値を捨て、マニフェストを取り直し、値は Unity のエコーバックで埋め直す)
- **プロキシに注意**。`HTTPS_PROXY` 等が設定された PC では WebSocket クライアントが
  LAN 宛の接続までプロキシに送ることがある(Python の `websockets` は既定で環境変数を見る)

## 7. 参照

| 対象 | 場所 |
|---|---|
| マニフェストのスキーマ(zod) | `packages/shared/src/schemas.ts` |
| `/sys/*` プロトコル仕様 | `docs/UNITY_PROTOCOL.md` |
| Unity モック | `packages/mock-unity/`(`--scenario packages/mock-unity/scenarios/default.json`) |
| WebSocket 実装 | `vendor/open-stage-control/src/server/node/ipc/` |
| HTTP ルーティング | `vendor/open-stage-control/src/server/node/server.mjs` |
| OSC I/O と custom module フック | `vendor/open-stage-control/src/server/node/osc/index.mjs` |
