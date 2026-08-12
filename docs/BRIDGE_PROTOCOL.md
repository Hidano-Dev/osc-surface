# ブリッジ接続仕様

この文書は、`oscdesk-bridge` と UI クライアントの間で交換する WebSocket フレームの正典である。新しい UI クライアントは、この文書と `protocol/wire-samples.json` だけを参照して実装できる。

## 前提と接続

ブリッジは Unity との OSC/UDP 通信と、UI クライアントとの WebSocket 通信を中継する。UI クライアントはブリッジの WebSocket ポートへ接続し、1 WebSocket メッセージにつき 1 個の JSON オブジェクトを送受信する。フレームはすべて UTF-8 JSON であり、配列形式や未知のキーは使用しない。

この接続には認証機構がない。`0.0.0.0` で待ち受ける構成を含むため、信頼された LAN 内だけで使用し、インターネットや信頼できないネットワークへ公開してはならない。

### ブリッジの起動

リポジトリのルートで Node.js 20 以降と pnpm を用意し、次を実行する。

```powershell
corepack pnpm install
corepack pnpm --filter @oscdesk/bridge run build
node packages/bridge/dist/oscdesk-bridge.js --config config/oscdesk.config.json
```

設定ファイルを省略せず、`--config` の値には `unity.host` と `unity.sendPort` を含む JSON 設定を指定する。ポートを一時的に上書きする場合は `--ws-port`、`--osc-listen-port`、`--unity-host`、`--unity-port`、`--ui-port`、`--debug` を使用できる。ブリッジは起動すると標準出力へ、次の形式の 1 行を出す。

```text
OSCDESK_BRIDGE_READY {"wsPort":7080,"oscListenPort":7091,"unity":{"host":"127.0.0.1","sendPort":7090},"uiPort":8080,"protocolVersion":1,"debug":false,"configPath":"..."}
```

クライアントはこの行または設定済みの `wsPort` を使い、`ws://<ブリッジのホスト>:<wsPort>` へ接続する。`hello` の `bridge.wsPort` と `bridge.oscListenPort` が、実際に使用するポートである。

## 共通規則

### 外側の形式と版数

全フレームは次の共通フィールドを持つ。

```json
{"v":1,"type":"..."}
```

`v` は常に数値 `1` である。受信した `v` が `1` と一致しないフレームは処理せず破棄し、版数不一致をブリッジまたは UI のログへ記録する。接続そのものは切断しない。`hello.protocolVersion` も常に `1` である。

フレームは `type` で判別する。各オブジェクトは仕様に定めたキーだけを持つ（未知キーを許可しない）。JSON の構文エラー、未知の `type`、必須キー欠落、型違いもそのフレームだけを破棄してログに記録し、接続は維持する。

### OSC 引数の型タグ

`osc` の `args` は、引数が 1 個でも必ず配列で、順序を保つ。各要素は次のいずれかのオブジェクトである。

| `type` | `value` | 意味 |
|---|---|---|
| `i` | number（整数） | 整数 |
| `f` | number | 浮動小数点数 |
| `s` | string | 文字列 |
| `b` | string | blob のバイト列を base64 化した文字列 |

blob は JSON にバイナリを直接入れず、送信時にバイト列を標準 base64（例: `AAECAw==`）へ変換し、受信時に base64 からバイト列へ戻す。`type` と `value` の対応が不正な要素はフレーム全体を拒否する。

共通の OSC 部分は次の形である。`address` は `/` で始める。下りのフレームだけが `from` を持ち、上りには宛先フィールドを追加しない。送信先 Unity はブリッジの設定で決まる。

```json
{
  "v": 1,
  "type": "osc",
  "address": "/avatar/blend/smile",
  "args": [{"type":"f","value":0.5}]
}
```

## 下りフレーム（ブリッジ → UI）

ブリッジから UI へ送る種類は次の 6 種類である。

### `hello` — 接続情報

接続直後に、その UI クライアントだけへ 1 回送る。`clientId` は接続を識別する値である。`expectedProjectId` は設定が無い場合 `null`。`pingIntervalMs` は Unity への死活確認周期であり、WebSocket 心拍とは別である。

```json
{
  "v":1,"type":"hello","clientId":"ui-1","protocolVersion":1,
  "server":{"name":"oscdesk-bridge","version":"0.1.0"},
  "unity":{"host":"127.0.0.1","sendPort":7090},
  "bridge":{"oscListenPort":7091,"wsPort":7080},
  "expectedProjectId":"oscdesk-demo",
  "heartbeat":{"intervalMs":15000,"timeoutMs":30000},
  "pingIntervalMs":15000,"debug":false
}
```

### `manifest` — 操作対象のマニフェスト

接続時、Unity から新しいマニフェストを受理した時、または UI が `manifestRequest` を送った時に送る。`manifest` は次の形で、`version` は常に `1`、`projectId` は空でない文字列である。

```json
{
  "v":1,"type":"manifest",
  "manifest":{
    "version":1,"projectId":"oscdesk-demo",
    "entries":[{
      "address":"/avatar/blend/smile","label":"Smile","type":"f",
      "widget":"fader","range":[0,1],"default":0.5,"group":"avatar"
    }]
  }
}
```

各 `entries` 要素の `address` と `label` は必須。`type` は `i` / `f` / `s` / `b` / `bool`、`widget` は `fader` / `button` / `toggle` / `xy` / `text`。`range` は数値 2 個の配列、`default` は数値・文字列・真偽値、`group` は任意の文字列である。

### `osc` — Unity から受信した OSC

Unity から受信した通常の OSC を UI へ配信する。`from` は受信元の UDP ピアで、`host` は文字列、`port` は 1〜65535 の整数である。

```json
{"v":1,"type":"osc","address":"/avatar/blend/smile",
 "args":[{"type":"f","value":0.5}],
 "from":{"host":"127.0.0.1","port":7090}}
```

### `link` — Unity とマニフェストの状態

接続時と状態変化時に送る。`unity.reachability` は `unknown` / `reachable` / `lost`、`lastRttMs` と `lastPongSeq` は未確定なら `null`、`consecutiveLosses` は連続喪失数である。`manifest` は未受理なら `{ "state":"none" }`、受理済みなら `state:"accepted"` と `projectId`、`entryCount` を持つ。`lastRejection` は通常 `null` で、拒否があれば `ts`、`reason`（`project-mismatch` / `schema-error` / `json-parse-error`）、`detail`、`receivedProjectId` を持つ。

```json
{"v":1,"type":"link",
 "unity":{"reachability":"reachable","lastRttMs":4,"consecutiveLosses":0,"lastPongSeq":12},
 "manifest":{"state":"accepted","projectId":"oscdesk-demo","entryCount":1},
 "lastRejection":null}
```

### `heartbeat` — WebSocket 心拍

ブリッジが **15,000 ms 間隔**で送る。`t` は送信時点の Unix epoch 時刻（ミリ秒）の数値である。UI は受信した `t` をそのまま `heartbeatAck` の `t` にして直ちに返す。ブリッジが最後に受信してから **30,000 ms** を超えると、その接続をタイムアウトとして切断する。

```json
{"v":1,"type":"heartbeat","t":1720000000000}
```

### `notice` — 注意・エラー通知

不正な上りフレームなど、UI に知らせるべき事象を送る。`level` は `info` / `warn` / `error`、`code` と `detail` は文字列である。

```json
{"v":1,"type":"notice","level":"warn","code":"bad-frame","detail":"discarded"}
```

## 上りフレーム（UI → ブリッジ）

UI から送る種類は次の 3 種類である。

### `osc` — Unity へ送る OSC

`address` と型タグ付き `args` を送る。`from`、`target`、配列形式の旧イベント名などは付けない。ブリッジは設定された Unity の `host` と `sendPort` へ転送し、内部予約アドレスへの送信は拒否する。

```json
{"v":1,"type":"osc","address":"/avatar/pos",
 "args":[{"type":"f","value":0.1},{"type":"f","value":0.9}]}
```

### `manifestRequest` — マニフェスト再要求

引数を持たない。ブリッジが既に受理したマニフェストを、その要求元の UI だけへ再送する。まだ受理していなければ何も返さない。このフレームは Unity へ転送しない。

```json
{"v":1,"type":"manifestRequest"}
```

### `heartbeatAck` — 心拍応答

`heartbeat` の `t` をそのまま返す。ブリッジはこの受信を接続の生存確認に使う。

```json
{"v":1,"type":"heartbeatAck","t":1720000000000}
```

## 接続時とエラー時の動作

1. UI が WebSocket 接続を確立する。
2. ブリッジが `hello`、`link`、受理済みなら `manifest` の順に送る。
3. UI は `heartbeat` に応答し、`link` と `manifest` を状態へ反映する。
4. UI の操作は上り `osc` で送り、Unity からのエコーバックは下り `osc` で受け取る。下り `osc` の値だけを UI の確定値として扱う。
5. JSON 構文、版数、未知キー、未知種別、型タグなどの検証に失敗したフレームは破棄される。接続は維持され、ブリッジが処理した上り不正フレームには可能なら `notice` も返す。
6. 心拍タイムアウトで切断された場合、UI は再接続し、接続後に `manifestRequest` を送って状態を再取得する。

## ワイヤ見本との対応

すべての実例は `protocol/wire-samples.json` に手書きで収録している。同ファイルの `cases` の `name` と本書の種類は次の対応になる。

| 本書 | `wire-samples.json` の `name` |
|---|---|
| 下り `hello` | `downstream-hello` |
| 下り `manifest` | `downstream-manifest` |
| 下り `osc` | `downstream-osc-float` |
| 下り `link` | `downstream-link` |
| 下り `heartbeat` | `downstream-heartbeat` |
| 下り `notice` | `downstream-notice` |
| 上り `osc` | `upstream-osc-multi` |
| 上り `manifestRequest` | `upstream-manifest-request` |
| 上り `heartbeatAck` | `upstream-heartbeat-ack` |

見本には、単一引数でも配列を保持する例、blob の base64、異常系（旧配列形式、未知キー、`v:2`、未知種別、不正な型タグ）も含まれる。実装時は `direction`、`valid`、`frame` を照合し、正しい 9 種のフレームと拒否規則を本書の記述どおりに実装する。
