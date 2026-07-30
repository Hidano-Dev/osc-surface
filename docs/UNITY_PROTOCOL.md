# UNITY_PROTOCOL.md - `/sys/*` プロトコル仕様

> 互換性ノートを含む仕様書 兼 実 Unity 接続手順書。仕様(§1〜§3)・実装指針(§4)・接続手順(§5)・互換性チェックリスト(§6)からなる本文は特定の OSC ライブラリに依存せず、本文だけで `/sys/*` の Unity 側実装と接続確認が完結する。
> 本仕様は OSC 1.0 標準の機能(基本型タグ・bundle・timetag)のみで成立させる。特定の OSC ライブラリ固有の挙動を前提にしてはならない。特定ライブラリを使った具体例は付録 A にのみ置く。

## 前提

- Unity が真実の源(source of truth)。UI は表示キャッシュにすぎず、値の確定は常に Unity からのエコーバックによる。
- トランスポートは UDP。アドレス・ポートは実行時設定(`config/surface.config.json`)で与える。

## 1. 到達性・診断

| 方向 | アドレス | 引数 | 用途 |
|---|---|---|---|
| Surface → Unity | `/sys/ping` | `int seq` | 到達性確認。2 秒間隔で送信 |
| Unity → Surface | `/sys/pong` | `int seq` | `/sys/ping` 受信時に **同じ seq を即時** 返信 |
| Surface → Unity | `/sys/stats/request` | (なし) | 受信統計の要求 |
| Unity → Surface | `/sys/stats` | `string json` | 受信統計 JSON を返信 |

`/sys/stats` の JSON ペイロード:

```json
{ "received": 0, "parseErrors": 0, "lastReceivedAt": "ISO-8601 文字列" }
```

### Phase 1 詳細仕様

- Surface 側は RTT、連続喪失数、最後に採用した pong の `seq` を保持する。
- ping は 2 秒間隔で送信し、未応答 ping は常に最大 1 件だけ保持する。
- 次の ping 送信時点で前回 ping が未応答なら、その ping は喪失として扱い、連続喪失数を `+1` して新しい `seq` に置き換える。
- `pong` は保持中の `seq` と一致した場合のみ採用し、その時点で RTT を確定し、連続喪失数を `0` に戻す。
- 未知 `seq`、期限切れ `seq`、重複 `seq` の `pong` は破棄し、RTT と連続喪失数を更新しない。

### `/sys/stats` 計数規則

- `received` は **正常に decode できた全メッセージ数** を表す。
- `/sys/*` 以外の通常メッセージも `received` に含める。
- `/sys/stats/request` 自体も `received` に含める。
- OSC bundle は bundle 全体を 1 件とは数えず、**展開後の各メッセージを個別に 1 件** として数える。
- decode 失敗したデータグラムは `received` に含めず、`parseErrors` のみを `+1` する。
- `lastReceivedAt` は最後に正常 decode したメッセージの受信時刻を ISO-8601 文字列で保持する。
- `/sys/stats/request` 自体も正常受信として数えるため、`/sys/stats` 応答時点では少なくともその要求の受信時刻まで `lastReceivedAt` が更新済みである。

## 2. マニフェストハンドシェイク

| 方向 | アドレス | 引数 | 用途 |
|---|---|---|---|
| Surface → Unity | `/sys/manifest/request` | (なし) | マニフェスト要求 |
| Unity → Surface | `/sys/manifest` | `string json` | マニフェスト JSON を返信 |

`/sys/manifest` の型タグは `s` 1 引数のみ。bundle や拡張型タグは使わず、OSC 1.0 標準の機能のみで成立させる。

マニフェストのスキーマ(正規定義は `packages/shared` の zod `ManifestSchema` を参照する):

```ts
{
  version: 1,
  projectId: string,          // 必須。空でない、人間が決める任意の識別子
  entries: [{
    address: string,        // 例: "/avatar/blend/smile"
    label: string,          // 表示名(日本語可) 例: "笑顔"
    type: "i" | "f" | "s" | "b" | "bool",
    widget: "fader" | "button" | "toggle" | "xy" | "text",
    range?: [number, number],
    default?: number | string | boolean,
    group?: string          // UI セクション分け用
  }]
}
```

- `projectId` はプロジェクトを識別するための必須フィールドである。値は人間が決める任意の非空文字列とし、UUID や特定の命名規則は要求しない。`version` は `1` のままであり、`projectId` を持たない旧形式のマニフェストは受理しない。
- 各エントリには現在値を `default` として含め、UI 表示を Unity の実状態に同期させる。
- `type` の意味:
  - `"i"` = int32、`"f"` = float32、`"s"` = string
  - `"b"` = blob(byte array。OSC 1.0 の `b` タグに対応)。UI の値同期の対象外(互換性ノート参照)
  - `"bool"` = 真偽値。Phase 2 時点の確定挙動として int(`i` タグ)の 0/1 で送受信する。`T`/`F` タグへの変換は未実装の将来オプション(互換性ノート参照)

### Phase 2 確定仕様: 要求・再送・回復

- Surface は起動して宛先へ送信可能になった直後に `/sys/manifest/request` を送信し、応答を **採用** するまで 2 秒間隔で無制限に再送する。採用した時点で再送を停止する。
- 個別要求への応答期限は設けない。応答が届かない・届いても検証に失敗する間は、単に再送が続く。
- ping/pong の到達性が喪失状態(連続喪失 1 以上)から回復した時点で、採用済みであっても要求を再開し、最新のマニフェストを取得し直す(Unity 再起動でパラメータ構成やキャラクター名が変わっている可能性があるため)。
- Unity 側は受信した要求それぞれに応答してよい。重複応答への特別な配慮は不要で、**重複応答を冪等に扱えばよい**。Surface 側では同一内容の再採用は冪等(UI 状態は同一に収束する)。
- Unity は起動時などに、要求を受けていなくても `/sys/manifest` を **自発送信してよい**。Surface は要求の有無に関係なく受信したマニフェストを検証して冪等に受理する(Unity の高速再起動が Surface の喪失検出をすり抜けた場合でも、最新マニフェストが届く経路を確保するため)。

### Phase 2 確定仕様: 応答の検証と採用

- Surface は受信ペイロードを JSON パースし、`packages/shared` の zod `ManifestSchema` で検証する。これが唯一の受け入れ判定である。
- 検証失敗(JSON パース不能・スキーマ違反)の場合: 当該マニフェストは **不採用** とし、原因(zod issue の path 含む)をログへ出力し(同一理由の連続拒否はログ抑制)、直前に採用済みのマニフェストと UI 状態を維持したまま稼働を継続する。要求の再送も継続する。
- 検証成功の場合: 最新版として採用し、UI(ラベル・レンジ・動的生成ウィジェット)へ適用する。

### 誤接続ガード(プロジェクト識別子の照合)

- Surface の config には、必要に応じて `expectedProjectId` を設定できる。未設定の場合は `projectId` の照合を行わず、スキーマ検証に成功したマニフェストを採用する。空文字は設定値として無効である。
- `expectedProjectId` が設定されている場合、Surface は JSON パースと `ManifestSchema` による検証が成功した後に、受信した `projectId` と `expectedProjectId` を厳密な文字列比較で照合する。大文字・小文字、前後の空白、Unicode 正規化を暗黙に変換してはならない。
- 一致した場合だけマニフェストを採用し、UI を生成・更新する。不一致の場合は `project-mismatch` として不採用にし、直前に採用済みのマニフェスト、UI、表示キャッシュを変更しない。要求中であれば要求の再送を継続し、採用済みであれば採用状態を維持する。
- 不一致は debug 設定に関係なく、`kind: "guard-reject"`、`expectedProjectId`、受信した `receivedProjectId` を含む NDJSON (`osc-guard-*.ndjson`) に記録し、診断パネルの誤接続ガード行にも反映する。同一理由の連続拒否はログを抑制してよいが、拒否判定とパネルの累計は維持する。

このガードは誤ったマニフェストの採用を防ぐためのものであり、認証・暗号化ではない。また、マニフェスト以外の OSC メッセージには識別子を付与しないため、アドレスが偶然一致した別プロジェクトからの値エコーバックや値更新を防ぐものではない。状態保護の対象は `project-mismatch` の拒否だけである。JSON パース失敗またはスキーマ違反は従来どおり不採用として要求を再送するため、採用済み状態でそれらを受信した場合は、正しい応答の再受信後に UI が再適用されることがある。

### Phase 2 確定仕様: 現在値による表示同期

- 採用したマニフェストの各エントリ `default`(Unity の現在値)は、対応ウィジェットの **表示更新としてのみ** 反映する。この反映で Surface から Unity への OSC 送信は発生しない(フィードバックループ禁止)。
- 値の確定は引き続き Unity からのエコーバックのみによる(§3)。マニフェストの `default` は接続直後・再接続直後の表示を実状態へ寄せる初期同期にすぎない。
- `type: "b"`(blob)のエントリは値同期の対象外としてスキップし、警告ログのみ残す。`type: "bool"` の値同期は `i` タグの 0/1 で表現する。

## 3. 双方向同期の規律

1. UI 操作 -> OSC 送信(Surface -> Unity)
2. Unity が値を確定し、**同一アドレス** にエコーバック(Unity -> Surface)
3. Surface はエコーバックを受けてウィジェット表示を確定する
4. ドラッグ操作中のウィジェットに対する受信値は無視する。操作終了後の最終エコーバックで整合する

## 4. 実装指針(擬似コード)

本節は、任意の OSC ライブラリの上で `/sys/*` プロトコルの Unity 側を実装するための指針である。特定ライブラリの API には依存しない。擬似コードが前提とする仮想操作は次の 2 つだけである。

- `osc_decode(data)` — 受信データグラムを OSC パケット(メッセージまたは bundle)に復号する
- `osc_send(address, args)` — **設定された返信先(ホスト・ポート)** へ OSC メッセージを単一データグラムで送信する。受信データグラムの送信元へ返す操作ではない(互換性ノート参照)

### 4.1 受信統計の持ち方

保持する状態:

```text
state:
  received: int = 0                   // 正常に decode できた「展開後」メッセージ数
  parseErrors: int = 0                // decode に失敗したデータグラム数
  lastReceivedAt: timestamp           // 最後に正常 decode したメッセージの受信時刻
  currentValues: map<address, value>  // 通常メッセージの現在値(マニフェスト default 用。§4.3)
```

受信処理の骨格(全メッセージ共通の前段。計数規則は §1 の定義に従う):

```text
on datagramReceived(data):
  packet = osc_decode(data)
  if decode 失敗:
    parseErrors += 1                  // received と lastReceivedAt は更新しない
    return
  handlePacket(packet)

handlePacket(packet):
  if packet is bundle:
    for element in packet.elements:
      handlePacket(element)           // 再帰展開。計数は展開後のメッセージ単位
    return
  received += 1                       // 計数と時刻更新はディスパッチより先に行う。
  lastReceivedAt = now()              // したがって /sys/stats/request 自身も数えられる
  dispatch(packet)

dispatch(message):
  switch message.address:
    case "/sys/ping":             replyPong(message.args)       // §4.2
    case "/sys/stats/request":    replyStats()                  // 本節末尾
    case "/sys/manifest/request": replyManifest()               // §4.3
    case 上記以外の "/sys/*":      return                        // 計数のみ。応答しない
    default:                      handleNormalMessage(message)  // §4.3(値記録 + §3 のエコーバック)
```

stats 応答:

```text
replyStats():
  payload = {
    received: received,
    parseErrors: parseErrors,
    lastReceivedAt: iso8601_utc(lastReceivedAt)   // 例: "2026-07-24T12:34:56.789Z"
  }
  osc_send("/sys/stats", [ string(json_encode(payload)) ])
```

補足:

- 利用ライブラリが bundle を自動展開して要素単位でコールバックを呼ぶ場合、`handlePacket` の bundle 分岐は書かなくてよい(骨格と等価な挙動になる)
- timetag による実行遅延は要求しない。bundle の timetag は無視し、受信後すぐ処理してよい
- 利用ライブラリが decode 失敗を通知しない場合、`parseErrors` は観測できない。その場合は常に 0 を報告し、統計の読み手がその前提を了解しておく
- `lastReceivedAt` は ISO-8601 のオフセット付き表記が必須(`Z` 終端の UTC を規範例とする)

### 4.2 pong 実装

```text
replyPong(args):
  seq = args[0]                        // int32。検査・保持・解釈はしない
  osc_send("/sys/pong", [ int(seq) ])  // 受信した seq をそのまま即時返信
```

- 受信した `seq` をそのまま返す以外の責務はない。喪失判定・RTT 計測・再送はすべて Surface 側の責務である(§1)
- 「即時」はイベントループやフレーム処理の次の送信機会で十分。処理遅延は Surface 側で RTT として観測されるだけで、プロトコル上の害はない

### 4.3 マニフェスト生成と応答

アプリ側はエントリ定義(何を操作可能として公開するか)を静的に持ち、値は `currentValues` を優先して埋める。

```text
entryDefs: list of {
  address, label, type, widget,   // 必須
  range?, initial?, group?        // 任意(initial は起動直後の default 用)
}

replyManifest():
  entries = []
  for def in entryDefs:
    entry = { address: def.address, label: def.label, type: def.type, widget: def.widget }
    if def.range が定義済み:   entry.range = def.range
    current = currentValues[def.address] ?? def.initial
    if current が定義済み:     entry.default = current     // 現在値を default として埋める(§2 値同期)
    if def.group が定義済み:   entry.group = def.group
    entries.append(entry)
  payload = { version: 1, projectId: projectId, entries: entries }
  osc_send("/sys/manifest", [ string(json_encode_utf8(payload)) ])  // s 1 引数・単一データグラム
```

- `projectId` は送信側プロジェクト固有の非空文字列として、すべての `/sys/manifest` 応答に含める。`expectedProjectId` を設定している Surface と接続する場合は、両者が同じ文字列を事前に設定しておく。
- Unity 側でマニフェスト定義アセットが未割当、`projectId` が空、またはエントリ定義が不正な場合は、エラーを記録してマニフェストを送信しない。ping/pong、stats、通常値のエコーバックは継続する。

通常メッセージの処理(現在値の記録とエコーバック):

```text
handleNormalMessage(message):
  value = message.args の先頭にある対応可能な値   // int / float / string(真偽値は 0/1 の int)
  if value が取れた:
    currentValues[message.address] = value        // 次回マニフェストの default に反映される
  osc_send(message.address, message.args)         // 同一アドレスへ受信引数をそのまま返す(§3)
```

補足:

- 要求 1 件ごとに応答してよい。Surface は重複応答を冪等に受理するため(§2)、応答の抑制やデバウンスは不要
- 起動直後などに、要求を受けていなくても自発送信してよい(§2)
- JSON は UTF-8。任意フィールド(range / default / group)は値がないとき **キーごと省略** し、`null` を書かない(`ManifestSchema` は null を許容しない)
- JSON 全体は単一データグラムに収まること(~1.4KB 以内を推奨、実用上限 ~60KB。互換性ノート参照)

### 4.4 不変条件(§4 共通)

- 全送信は設定された返信先へ行う。受信データグラムの送信元ホスト・ポートへ返さない
- 使用する OSC 機能は基本型タグ `i` / `f` / `s` / `b` と bundle / timetag のみ。真偽値は `i` の 0/1 で送る(`T` / `F` タグは使わない)
- 配列引数・カラー型・64bit 整数・ライブラリ独自の bool 変換など、OSC 1.0 で解釈が割れやすい機能は使わない。表現上必要になった場合も使用せず、代替表現と理由を互換性ノートに記録する
- `/sys/stats` の JSON は `StatsPayloadSchema`、`/sys/manifest` の JSON は `ManifestSchema`(いずれも `packages/shared`)に適合させる
- `/sys/manifest` の JSON には、空でない `projectId` を必ず含める。`expectedProjectId` が設定された受信側は、スキーマ検証後に Unicode 正規化を行わず厳密比較する

## 5. 実 Unity 接続手順

### 5.1 前提条件とポート対応

トランスポートは UDP。次の 3 者(config・O-S-C 起動引数・Unity 側設定)が互いに一致している必要がある。

| 経路 | config(`config/surface.config.json`) | O-S-C 起動引数 | Unity 側 |
|---|---|---|---|
| Surface → Unity(ping・各要求・値送信) | `unity.host` : `unity.sendPort`(既定 `127.0.0.1:9000`) | `-s <unity.host>:<unity.sendPort>`(**一致必須**) | OSC 受信の待受ポート = `unity.sendPort` |
| Unity → Surface(pong・各応答・エコーバック) | `unity.receivePort`(既定 `9001`) | `-o <unity.receivePort>`(**一致必須**) | OSC 送信の宛先 = Surface マシンの IP : `unity.receivePort` |

- **返信先は設定で明示する**(互換性ノート再掲)。Unity 側は「受信データグラムの送信元へ返す」実装にせず、上表の宛先を設定値として持つこと
- **同一マシン構成**(Unity Editor と O-S-C を同じ PC で動かす): config は既定のまま。Unity 側は待受 9000、送信宛先 127.0.0.1:9001
- **LAN 分離構成**(Unity 実機が別マシン): `unity.host` を Unity 機の IP(例 `192.168.1.20`)へ変更し、Unity 側の送信宛先を Surface 機の IP(例 `192.168.1.10`)+ `9001` にする。O-S-C 起動引数も `-s 192.168.1.20:9000` に合わせる。両マシンのファイアウォールで UDP 受信(Unity 機: 9000 / Surface 機: 9001)を許可する
- 接続確認の間は debug ON の config(`config/surface.debug.config.json`。診断パネルと NDJSON ログが有効)での起動を推奨する。`OSC_SURFACE_CONFIG` は **絶対パス** で指定する(相対パスは O-S-C が custom module のディレクトリ基準で解決するため、リポジトリ root 基準の相対指定は失敗し既定 config で起動してしまう):

  ```powershell
  $env:OSC_SURFACE_CONFIG="$PWD\config\surface.debug.config.json"
  node vendor/open-stage-control/app -n -p 7080 -o 9001 -s 127.0.0.1:9000 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js
  Remove-Item Env:OSC_SURFACE_CONFIG
  ```

### 5.2 段階的疎通確認

前提: §4 を実装した Unity 側アプリ(具体例は付録 A)が起動済み、O-S-C headless が §5.1 の設定で起動済み、ブラウザで `http://<Surface ホスト>:7080` を開いている。

**① ping/pong の成立(到達性)**

- Surface は起動直後から 2 秒間隔で `/sys/ping` を送信している。ブラウザで `Diagnostics` モーダルを開き、到達性が「到達」になり RTT に数値(ms)が出ることを確認する
- debug OFF で起動している場合は診断パネルが反応しないため、② のマニフェスト反映で代替確認する
- 失敗したら → §5.3 の「到達性が『喪失』のまま」

**② マニフェストの採用**

- Surface は採用に成功するまで 2 秒間隔で `/sys/manifest/request` を送信している。ブラウザ UI にマニフェスト由来のラベルと動的生成ウィジェットが反映されることを確認する
- 失敗したら → §5.3 の「到達するがマニフェストが採用されない」

**③ 値のエコーバック確定**

- 任意のウィジェットを操作し、離した後に表示が確定する(Unity からのエコーバックで値が定まる)ことを確認する。診断パネルの最新メッセージで、送信(out)と同一アドレスの受信(in)のペアとして観測できる
- 失敗したら → §5.3 の「値が確定しない」

①〜③ が揃えば接続は成立している。

**④ /sys/stats の取得(任意・Unity 実装の確認)**

- Surface の通常運用は `/sys/stats/request` を送信しない(§1 の stats は診断・実装確認用のプロトコルである)。Unity 側の受信統計実装を確認したい場合は、任意の送信手段で `/sys/stats/request` を Unity の待受ポートへ送る
- 応答 `/sys/stats` は Unity に設定された返信先(= Surface の受信ポート)へ届くため、診断パネルの最新メッセージまたは NDJSON ログで JSON(received / parseErrors / lastReceivedAt)を確認する
- 本リポジトリのあるマシンからは、次のワンライナーで要求を送れる(リポジトリ root で実行。宛先は Unity の待受に合わせる):

  ```powershell
  node -e "const osc=require('osc'); const p=new osc.UDPPort({localAddress:'0.0.0.0',localPort:0,remoteAddress:'127.0.0.1',remotePort:9000}); p.on('ready',()=>{p.send({address:'/sys/stats/request',args:[]}); setTimeout(()=>process.exit(0),200)}); p.open()"
  ```

### 5.3 接続できないときの切り分け

| 症状 | 主な原因候補 | 確認・対処 |
|---|---|---|
| 到達性が「喪失」のまま / RTT が出ない | ポート・宛先の不一致 | §5.1 の 3 者対応を再確認。特に `-s` ↔ `unity.host:sendPort`、`-o` ↔ Unity 側の送信宛先ポート |
| 〃 | ファイアウォールの UDP 受信ブロック | Unity 機の待受ポート(9000)と Surface 機の受信ポート(9001)の UDP 受信を許可する |
| 〃 | 別サブネット | 診断パネルのサブネット判定が「別サブネット」なら、同一セグメントへの接続か経路設定を確認する |
| 〃 | Unity 側の未起動・pong 未実装 | Unity 側アプリの起動と §4.2 の実装を確認する |
| Editor の Pause 中だけ「喪失」になる | 正常挙動 | pong 返信はフレーム処理に依存するため Pause 中は応答が止まる。Play 再開で回復する |
| 到達するがマニフェストが採用されない | JSON がスキーマ検証に失敗 | O-S-C 側コンソールログの検証失敗(zod issue の path 付き)を確認し、`ManifestSchema` に適合させる(§2) |
| 〃 | ペイロードが大きすぎる | 単一データグラムに収まっているか確認する(~1.4KB 推奨。互換性ノート) |
| 手動配置ウィジェットは届くが動的生成ウィジェットだけ Unity に届かない | `-s` と config 宛先の不一致 | 動的生成ウィジェットはサーバ既定ターゲット(`-s`)へ送信する。`-s` を `unity.host:sendPort` に一致させる |
| 値が確定しない(操作後に表示が戻る・変わらない) | エコーバック未実装・別アドレスへの返信 | §3 のとおり **同一アドレス** へ受信引数をそのまま返しているか確認する |
| 〃 | エコーバック宛先の誤り | Unity → Surface の宛先(Surface 機 IP : `receivePort`)を確認する |
| ④ 実施時に stats 応答が来ない | dispatch 分岐・返信先の誤り | §4.1 の `/sys/stats/request` 分岐と返信先設定を確認する |

診断手段: 診断パネル(到達性・RTT・損失率・サブネット判定・ログ使用量・最新メッセージ)、デバッグモードの NDJSON ログ(`logs/diagnostics/osc-debug-*.ndjson`)、O-S-C 側コンソールログ。起動方法と観測手順の詳細は `docs/VERIFICATION.md` の Phase 3 を参照。

## 6. ライブラリ互換性チェックリスト

利用予定の OSC ライブラリ(独自 Fork 含む)が次を満たすか確認する。不適合の項目は右列の代替策を検討し、判断に迷う差異は互換性ノートの記録方針に従う。

| # | チェック項目 | 満たさない場合の代替策 |
|---|---|---|
| 1 | UTF-8 文字列(`s` タグ)を欠損なく送受信できる(日本語ラベル・JSON ペイロード) | JSON の非 ASCII 文字を `\uXXXX` エスケープする ASCII-safe 化(互換性ノート「文字列は UTF-8」) |
| 2 | 基本型タグ `i` / `f` / `s` を送受信できる(`b` は受信許容のみでよい) | 代替なし。本プロトコルの前提であり、満たさない場合は利用不可 |
| 3 | 送信宛先(ホスト・ポート)を設定で明示指定できる(受信元への自動返信に依存しない) | 代替なし(互換性ノート「返信先」)。必須要件 |
| 4 | bundle を受信展開できる(自動展開または要素へアクセスできる) | Surface の現行実装は bundle を送信しないため即座には問題にならないが、§4.1 の展開後メッセージ単位の計数を守れる形で吸収する |
| 5 | 想定ペイロードサイズのデータグラムを送受信できる(~1.4KB 推奨、実用上限 ~60KB) | マニフェストのエントリ数を減らして JSON を小さくする。それでも不足する場合の拡張はユーザー判断(互換性ノート「単一 UDP データグラム」) |
| 6 | アドレスをリテラル一致でディスパッチできる(OSC パターンマッチング機能は不要) | 本プロトコルはパターンを使わないため通常は問題にならない。受信側で意図せずパターン展開されないことだけ確認する |
| 7 | 真偽値を `i` の 0/1 として送信できる(`T` / `F` タグの強制がない、または回避できる) | 送信前に 0/1 の int へ変換する層を挟む(§4.4。互換性ノート「bool の実装状況」) |

## 互換性ノート

- Phase 1 以降、標準仕様と各ライブラリの差異が判明するたびここに追記する。
- 返信先は「受信データグラムの送信元に必ず返る」とはみなさない。運用上は返信先ホスト・ポートを設定で明示できる前提で実装する。
- mock-unity とテスト系では `osc` npm をコーデックとして使うが、プロトコル仕様自体は `osc` 固有仕様に依存しない。
- Phase 1 で許容する OSC 型は基本型タグ `i` / `f` / `s` / `b` と bundle / timetag のみである。
- `metadata: true` のようなライブラリ固有表現は実装都合にすぎず、相互接続仕様ではない。
- 配列引数、カラー型、64bit 整数、ライブラリ独自の bool 変換など、OSC 1.0 で解釈が割れやすい機能は使わない。
- 複数値が必要な場合は複数引数または JSON 文字列で表現し、特定ライブラリ固有の配列表現に依存しない。
- `received` の意味はライブラリ依存ではなく、本仕様で定義した「正常 decode できた展開後メッセージ件数」を正とする。
- bundle の計数も bundle 全体ではなく展開後メッセージ単位とする。ライブラリ側のイベント粒度が異なっても、この仕様に合わせて吸収する。
- 追加の解釈差異が見つかり、本体改造やプロトコル変更が必要な場合は、この節に差分と選択肢を記録した上でユーザー判断へ返す。

### Phase 2 追記(マニフェストハンドシェイク)

- **`/sys/manifest` は単一 UDP データグラムに収める**。OSC 1.0 にメッセージ分割・再結合の機構はない。IP フラグメンテーションを避けるには JSON 全体で **~1.4KB 以内を推奨**(一般的な MTU 1500 を想定)。フラグメント許容でも IPv4 UDP の理論上限から **実用上限は ~60KB** とみなす。これを超えるマニフェストが必要になった場合は、独断でプロトコルを拡張せず、選択肢(エントリ分割の拡張仕様・TCP 等の別トランスポート・エントリ数の削減)を添えてユーザー判断へ返す。
- **文字列は UTF-8**。OSC 1.0 は文字列のエンコーディングを規定しないため、本プロトコルでは `s` タグの文字列(`/sys/manifest` の JSON ペイロード含む)を UTF-8 と定める。Phase 2 の E2E で、UTF-8 マルチバイトの日本語キャラクター名が mock-unity(`osc` npm)→ O-S-C → ブラウザ UI の全経路を欠損なく往復することを実測済み。相手ライブラリが UTF-8 文字列を扱えない場合は、JSON ペイロードの非 ASCII 文字を `\uXXXX` エスケープする ASCII-safe 化が選択肢になる(JSON 仕様上は等価な表現。既定では行わない)。
- **`bool` の実装状況**: Phase 2 時点では値の送受信・表示同期とも `i` タグの 0/1 で行う(O-S-C ウィジェットの値が数値であるため)。§2 に記載していた `T`/`F` タグ変換と config フォールバックは未実装の将来オプションであり、`T`/`F` を要求する Unity 側ライブラリが現れた時点で差分をこの節に記録して判断へ返す。
- **`b`(blob)型の値同期非対応**: blob は UI ウィジェットの表示値として表現できないため、値同期の対象外(警告付きスキップ)を確定挙動とする。エントリ定義自体は許容する。
- **Phase 5 のプロジェクト識別子**: `projectId` は `/sys/manifest` の JSON ペイロード内のフィールドであり、OSC の型タグは従来どおり `s` 1 引数のままである。したがって OSC ライブラリの変更は不要で、JSON の必須フィールドとして扱う。`expectedProjectId` が設定されている場合の照合はスキーマ検証後の厳密な文字列比較であり、Unicode 正規化・大文字小文字変換・空白除去は行わない。識別子は人間が決める任意の非空文字列である。
- **誤接続ガードの制限**: 識別子不一致のマニフェストは採用せず、採用済み UI を維持するが、値エコーバックの受信は遮断しない。また、スキーマ不正や JSON パース失敗は識別子不一致とは別の拒否であり、要求再送による UI 再適用が発生し得る。拒否の NDJSON 記録は debug 設定に依存しない。
- **O-S-C リモートコマンドで実現できない更新要件の扱い**(開発規律): マニフェスト適用は O-S-C のリモートコマンド(`/EDIT` 等)の範囲で実現する。この範囲で実現できない更新要件が判明した場合は、本体改造や回避策を独断で実装せず、差分をこの節に記録し選択肢を添えてユーザーへ報告する。Phase 2 の実装(ラベル・レンジ更新、動的生成、現在値の表示同期)は `/EDIT` と表示専用の受信経路の範囲で全要件を実現でき、該当事項は発生しなかった。上記の `bool` 0/1 と `b` 型スキップが、実装中に判明した仕様と実装の差分・確定事項の全てである。

### Phase 4 追記(実装指針と実機検証)

- **timetag の遅延実行は要求しない**: bundle の timetag は無視して受信後すぐ処理してよい(§4.1 補足)。mock-unity・参照実装とも即時処理であり、遅延実行に依存する送信は行わない
- **`/sys/stats/request` は Surface の通常運用では送信されない**: §1 の stats は診断・実装確認用のプロトコルであり、Surface が自動送信するのは `/sys/ping` と `/sys/manifest/request` のみ。stats の動作確認手順は §5.2 ④ に記載した
- **uOSC(付録 A)で判明した差異**: decode 失敗が観測できず `parseErrors` は常に 0 / C# `bool` は送信できず 0/1 の `int` へ正規化 / 受信コールバックがフレーム同期のため RTT にフレーム時間が乗る。いずれもプロトコル自体の変更は不要で、詳細は付録 A.4 に記録した
- **実機検証済み**: Unity Editor(6000.0.36f1)+ uOSC 2.2.0 + 付録 A.2 の参照実装で、§5.2 の全段階(到達性・マニフェスト採用・エコーバック・stats)、Pause 中の喪失表示と Play 再開での回復、回復時のマニフェスト自動再要求、操作後の現在値が `default` に反映された再マニフェストまでをループバック構成で確認した(2026-07-24)

## 付録 A: uOSC 参照実装

uOSC(hecomi 版 v2 系、検証バージョン 2.2.0)を採用する場合の具体例。本文 §1〜§6 はこの付録に依存しない。別ライブラリの利用者は A.3 の読み替え表を自分のライブラリの API に置き換えるだけで、本文 §4 の擬似コードをそのまま実装できる。

### A.1 導入(UPM)

`Packages/manifest.json` にスコープドレジストリと依存を追加する:

```json
{
  "dependencies": {
    "com.hecomi.uosc": "2.2.0"
  },
  "scopedRegistries": [
    {
      "name": "hecomi",
      "url": "https://registry.npmjs.com",
      "scopes": ["com.hecomi"]
    }
  ]
}
```

- スコープドレジストリを初めて追加した直後の Editor 起動では「Importing a scoped registry」の確認ダイアログが表示され、閉じるまで Editor が停止して見えることがある。`Close` で閉じてよい
- 代替導入(レジストリ障害時など): UPM の git URL `https://github.com/hecomi/uOSC.git#upm`、または GitHub Releases の `.unitypackage`

### A.2 参照実装(C# 2 ファイル全文)

使い方: 空の GameObject に `OscSurfaceBridge` を追加し(`RequireComponent` で `uOscServer` / `uOscClient` も自動追加される)、インスペクタで次を設定して Play する。

- `uOscServer.port` = Surface config の `unity.sendPort`(既定 9000)
- `uOscClient.address` / `port` = Surface ホスト : `unity.receivePort`(既定 `127.0.0.1` : 9001)
- `manifestAsset` = `OscSurfaceManifestAsset` の同梱アセット(またはプロジェクト固有のアセット)

付録 A の C# 全文は、各節のコードブロックを除いて次のリポジトリ実ファイルと一致することを不変条件とする。修正時は対応するファイルとコードブロックを同時に更新する。

#### A.2.1 `OscSurfaceBridge.cs` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/OscSurfaceBridge.cs` である。

```csharp
// OscSurfaceBridge.cs — docs/UNITY_PROTOCOL.md 付録 A.2 の参照実装(uOSC 2.2.0)
// 本文 §4(実装指針)の擬似コードを 1:1 で具体化した単一 MonoBehaviour。
// 使い方: 空の GameObject に本コンポーネントを追加し(uOscServer / uOscClient は自動追加される)、
//   - uOscServer.port   = Surface config の unity.sendPort(既定 9000)
//   - uOscClient.address/port = Surface ホスト : unity.receivePort(既定 127.0.0.1 : 9001)
// をインスペクタで設定する(§5.1 のポート対応)。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;
using uOSC;

[RequireComponent(typeof(uOscServer), typeof(uOscClient))]
public sealed class OscSurfaceBridge : MonoBehaviour
{
    // デモ用の表示名。エントリ定義中の {characterName} を置き換える
    [SerializeField] private string characterName = "UnityBridge";
    [SerializeField] private OscSurfaceManifestAsset manifestAsset;

    // §4.1 受信統計
    private int received;
    private int parseErrors; // uOSC は decode 失敗を通知しないため常に 0 を報告する(付録 A.4)
    private string lastReceivedAt = "1970-01-01T00:00:00.000Z"; // ISO-8601 UTC(Z 終端)

    // §4.3 現在値ストア(マニフェスト default 用)
    private readonly Dictionary<string, object> currentValues = new Dictionary<string, object>();

    private uOscServer server;
    private uOscClient client; // 全送信の出口 = 設定された返信先(§4.4)

    private void Awake()
    {
        // 起動直後の現在値をエントリ定義の初期値で埋める(§4.3)
        if (!TryGetValidatedAsset(out var asset))
        {
            return;
        }

        foreach (var entry in asset.entries)
        {
            if (TryGetDefaultValue(entry, out var initial))
            {
                currentValues[entry.address] = ResolveInitial(initial);
            }
        }
    }

    private void OnEnable()
    {
        server = GetComponent<uOscServer>();
        client = GetComponent<uOscClient>();
        server.onDataReceived.AddListener(OnDataReceived);

        // 要求を受けていなくても起動時に自発送信してよい(§2 / §4.3 補足)
        SendManifest();
    }

    private void OnDisable()
    {
        server.onDataReceived.RemoveListener(OnDataReceived);
    }

    // §4.1 受信処理の骨格。uOSC は bundle を自動展開して展開後メッセージ単位で
    // このコールバックを呼ぶため、bundle 分岐は不要(§4.1 補足 / 付録 A.3)
    private void OnDataReceived(Message message)
    {
        // 計数と時刻更新はディスパッチより先(/sys/stats/request 自身も数える)
        received += 1;
        lastReceivedAt = NowIso8601();

        switch (message.address)
        {
            case "/sys/ping": // §4.2
                if (message.values.Length > 0 && message.values[0] is int seq)
                {
                    SendPong(seq);
                }
                return;
            case "/sys/stats/request": // §4.1
                SendStats();
                return;
            case "/sys/manifest/request": // §4.3
                SendManifest();
                return;
        }

        if (message.address.StartsWith("/sys/", StringComparison.Ordinal))
        {
            return; // 上記以外の /sys/* は計数のみ。応答しない
        }

        HandleNormalMessage(message);
    }

    // §4.2 受信した seq をそのまま即時返信。検査・保持・解釈はしない
    private void SendPong(int seq)
    {
        client.Send("/sys/pong", seq);
    }

    private void SendStats()
    {
        client.Send("/sys/stats", BuildStatsJson());
    }

    private void SendManifest()
    {
        if (TryBuildManifestJson(out var json))
        {
            client.Send("/sys/manifest", json);
        }
    }

    // §4.3 通常メッセージ: 現在値の記録 + 同一アドレスへのエコーバック(§3)
    private void HandleNormalMessage(Message message)
    {
        foreach (var value in message.values)
        {
            if (value is int || value is float || value is string)
            {
                RecordValue(message.address, value);
                break;
            }
        }

        var echoed = new object[message.values.Length];
        for (var i = 0; i < message.values.Length; i++)
        {
            echoed[i] = NormalizeValue(message.values[i]);
        }

        client.Send(message.address, echoed);
    }

    private void RecordValue(string address, object value)
    {
        if (manifestAsset == null || manifestAsset.entries == null)
        {
            return;
        }

        foreach (var entry in manifestAsset.entries)
        {
            if (entry.address == address && TypeMatches(TypeName(entry.type), value))
            {
                currentValues[address] = value;
                return;
            }
        }
    }

    private static bool TypeMatches(string entryType, object value)
    {
        switch (entryType)
        {
            case "i": return value is int;
            case "f": return value is int || value is float;
            case "s": return value is string;
            case "bool": return value is bool; // 値の授受は i の 0/1 のため実運用では更新されない(§2)
            default: return false; // "b"(blob)は値同期の対象外
        }
    }

    // §4.4 真偽値は i の 0/1 で送る(T/F タグを使わない)
    private static object NormalizeValue(object value)
    {
        if (value is bool flag)
        {
            return flag ? 1 : 0;
        }

        return value;
    }

    private string BuildStatsJson()
    {
        return "{\"received\":" + received.ToString(CultureInfo.InvariantCulture)
            + ",\"parseErrors\":" + parseErrors.ToString(CultureInfo.InvariantCulture)
            + ",\"lastReceivedAt\":" + Quote(lastReceivedAt) + "}";
    }

    // §4.3 任意フィールド(range / default / group)は値がないときキーごと省略し、null を書かない
    private bool TryBuildManifestJson(out string json)
    {
        json = null;
        if (!TryGetValidatedAsset(out var asset))
        {
            return false;
        }

        var sb = new StringBuilder();
        sb.Append("{\"version\":1,\"projectId\":").Append(Quote(asset.projectId)).Append(",\"entries\":[");

        for (var i = 0; i < asset.entries.Count; i++)
        {
            var entry = asset.entries[i];

            if (i > 0)
            {
                sb.Append(',');
            }

            sb.Append("{\"address\":").Append(Quote(entry.address));
            sb.Append(",\"label\":").Append(Quote(ApplyCharacterName(entry.label)));
            sb.Append(",\"type\":").Append(Quote(TypeName(entry.type)));
            sb.Append(",\"widget\":").Append(Quote(WidgetName(entry.widget)));

            if (entry.hasRange)
            {
                sb.Append(",\"range\":[").Append(FormatNumber(entry.rangeMin))
                    .Append(',').Append(FormatNumber(entry.rangeMax)).Append(']');
            }

            if (currentValues.TryGetValue(entry.address, out var current))
            {
                sb.Append(",\"default\":").Append(JsonValue(current)); // 現在値を default として埋める(§2)
            }

            if (!string.IsNullOrEmpty(entry.group))
            {
                sb.Append(",\"group\":").Append(Quote(entry.group));
            }

            sb.Append('}');
        }

        sb.Append("]}");
        json = sb.ToString();
        return true;
    }

    private bool TryGetValidatedAsset(out OscSurfaceManifestAsset asset)
    {
        asset = manifestAsset;
        if (asset == null)
        {
            Debug.LogError("OscSurfaceBridge requires an OscSurfaceManifestAsset.", this);
            return false;
        }

        if (string.IsNullOrWhiteSpace(asset.projectId))
        {
            Debug.LogError("OscSurfaceManifestAsset projectId must not be empty.", asset);
            return false;
        }

        if (asset.entries == null)
        {
            Debug.LogError("OscSurfaceManifestAsset entries must not be null.", asset);
            return false;
        }

        foreach (var entry in asset.entries)
        {
            if (entry == null || string.IsNullOrWhiteSpace(entry.address))
            {
                Debug.LogError("OscSurfaceManifestAsset contains an entry with an empty address.", asset);
                return false;
            }

            // 壊れた YAML などで enum に範囲外の値が入っていたら送信を中止する(§4.3)
            if (!Enum.IsDefined(typeof(OscSurfaceManifestAsset.EntryType), entry.type)
                || !Enum.IsDefined(typeof(OscSurfaceManifestAsset.WidgetType), entry.widget)
                || !Enum.IsDefined(typeof(OscSurfaceManifestAsset.DefaultKind), entry.defaultKind))
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset entry \"" + entry.address + "\" has an undefined enum value.", asset);
                return false;
            }
        }

        return true;
    }

    private static bool TryGetDefaultValue(OscSurfaceManifestAsset.Entry entry, out object value)
    {
        switch (entry.defaultKind)
        {
            case OscSurfaceManifestAsset.DefaultKind.Int: value = entry.defaultInt; return true;
            case OscSurfaceManifestAsset.DefaultKind.Float: value = entry.defaultFloat; return true;
            case OscSurfaceManifestAsset.DefaultKind.String: value = entry.defaultString; return true;
            case OscSurfaceManifestAsset.DefaultKind.Bool: value = entry.defaultBool; return true;
            default: value = null; return false;
        }
    }

    private static string TypeName(OscSurfaceManifestAsset.EntryType type)
    {
        switch (type)
        {
            case OscSurfaceManifestAsset.EntryType.Int: return "i";
            case OscSurfaceManifestAsset.EntryType.Float: return "f";
            case OscSurfaceManifestAsset.EntryType.String: return "s";
            case OscSurfaceManifestAsset.EntryType.Blob: return "b";
            case OscSurfaceManifestAsset.EntryType.Bool: return "bool";
            default: return "";
        }
    }

    private static string WidgetName(OscSurfaceManifestAsset.WidgetType widget)
    {
        switch (widget)
        {
            case OscSurfaceManifestAsset.WidgetType.Fader: return "fader";
            case OscSurfaceManifestAsset.WidgetType.Button: return "button";
            case OscSurfaceManifestAsset.WidgetType.Toggle: return "toggle";
            case OscSurfaceManifestAsset.WidgetType.Xy: return "xy";
            case OscSurfaceManifestAsset.WidgetType.Text: return "text";
            default: return "";
        }
    }

    private object ResolveInitial(object initial)
    {
        return initial is string text ? ApplyCharacterName(text) : initial;
    }

    private string ApplyCharacterName(string template)
    {
        return template.Replace("{characterName}", characterName ?? string.Empty);
    }

    private static string NowIso8601()
    {
        return DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    }

    private static string JsonValue(object value)
    {
        switch (value)
        {
            case int intValue: return intValue.ToString(CultureInfo.InvariantCulture);
            case float floatValue: return FormatNumber(floatValue);
            case bool boolValue: return boolValue ? "true" : "false";
            case string stringValue: return Quote(stringValue);
            default: return Quote(value.ToString());
        }
    }

    private static string FormatNumber(float value)
    {
        return value.ToString("R", CultureInfo.InvariantCulture);
    }

    private static string Quote(string value)
    {
        var sb = new StringBuilder(value.Length + 2);
        sb.Append('"');

        foreach (var ch in value)
        {
            switch (ch)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (ch < ' ')
                    {
                        sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        sb.Append(ch);
                    }
                    break;
            }
        }

        sb.Append('"');
        return sb.ToString();
    }
}

```

#### A.2.2 `OscSurfaceManifestAsset.cs` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/OscSurfaceManifestAsset.cs` である。

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(menuName = "OSC Surface/Manifest Asset", fileName = "OscSurfaceManifest")]
public sealed class OscSurfaceManifestAsset : ScriptableObject
{
    public string projectId = "";
    public List<Entry> entries = new List<Entry>();

    public enum EntryType
    {
        Int,
        Float,
        String,
        Blob,
        Bool,
    }

    public enum WidgetType
    {
        Fader,
        Button,
        Toggle,
        Xy,
        Text,
    }

    public enum DefaultKind
    {
        None,
        Int,
        Float,
        String,
        Bool,
    }

    [Serializable]
    public sealed class Entry
    {
        public string address = "";
        public string label = "";
        public EntryType type;
        public WidgetType widget;
        public bool hasRange;
        public float rangeMin;
        public float rangeMax;
        public DefaultKind defaultKind;
        public int defaultInt;
        public float defaultFloat;
        public string defaultString = "";
        public bool defaultBool;
        public string group = "";
    }
}

```

同梱アセットは、上記 C# 型を Unity の YAML として保存した例である。以下は構造確認用の抜粋であり、アセット全文の一致を検証対象にはしない。特に `m_Script` の GUID はプロジェクトごとに異なるため、**スクリプト参照 GUID は不変条件の対象外**である。

```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_Script: {fileID: 11500000, guid: <プロジェクト固有の GUID>, type: 3}
  m_Name: OscSurfaceManifest
  projectId: osc-surface-demo
  entries:
  - address: /avatar/blend/smile
    label: '{characterName} Smile'
    type: 1
    widget: 0
    hasRange: 1
    rangeMin: 0
    rangeMax: 1
    defaultKind: 2
    defaultFloat: 0.35
    group: Face
  # 以下のエントリは省略
```

### A.3 本文 §4 との対応と読み替え表

| 本文 §4 の操作・前提 | uOSC(A.2)での実現 | 別ライブラリへの読み替え観点 |
|---|---|---|
| 受信ハンドラの登録(`on datagramReceived` → `handlePacket`) | `OscSurfaceBridge.cs` の `uOscServer.onDataReceived.AddListener(OnDataReceived)` | 受信コールバック(またはポーリング)の登録 API に置き換える |
| bundle の再帰展開(§4.1 骨格の手順 2) | uOSC が自動展開し、展開後メッセージ単位でコールバックが呼ばれるため bundle 分岐は書いていない | 自動展開しないライブラリでは §4.1 の骨格どおり再帰展開を自前で書く |
| マニフェスト定義の読み込み | `OscSurfaceBridge.cs` が `OscSurfaceManifestAsset.cs` の ScriptableObject を検証して JSON 化する | 設定アセットを読み込み、本文 §2 の JSON フィールドへシリアライズする |
| 計数と時刻更新をディスパッチに先行(§4.1) | `OscSurfaceBridge.cs` の `OnDataReceived` 冒頭で `received` / `lastReceivedAt` を更新 | そのまま同じ順序で実装する |
| `osc_send`(設定された返信先へ送信) | `uOscClient.Send(address, args...)`。宛先はインスペクタの `address` / `port` で固定 | 送信 API で宛先ホスト・ポートを明示指定できること(§6 の #3) |
| 真偽値は `i` の 0/1(§4.4) | `OscSurfaceBridge.cs` の `NormalizeValue` で C# `bool` を 0/1 の `int` へ変換してから送信 | ライブラリが bool を `T`/`F` タグにする場合は同様の変換層を挟む |
| 排他制御 | 不要。uOSC は `onDataReceived` を **メインスレッド** で呼ぶ | 受信スレッドでコールバックするライブラリでは共有状態に排他が必要 |
| `parseErrors` の計数(§4.1) | `OscSurfaceBridge.cs` は観測不能のため常に 0(A.4) | decode 失敗を通知する API があれば §4.1 どおり計数する |

### A.4 uOSC 固有の差異と制約

- **`parseErrors` が観測不能**: uOSC は decode に失敗したデータグラムを外部へ通知しない。参照実装は常に 0 を報告する(§4.1 補足の「通知しないライブラリ」の具体例)
- **対応型は int / float / string / byte[]**: C# の `bool` は送信できないため、0/1 の `int` へ正規化して送る(§4.4 と一致。`T`/`F` タグは使われない)
- **受信コールバックはメインスレッド(フレーム同期)**: pong 返信がフレーム処理に乗るため、RTT にフレーム時間ぶんの揺らぎが加わる。Editor の Pause 中は応答が止まり、Surface 側は喪失と表示する(§5.3 の正常挙動)
- **受信は `uOscServer`・送信は `uOscClient` に分離**: 送信宛先は常に `uOscClient` の設定値であり、「返信先を設定で明示する」前提(§4.4・互換性ノート)と自然に一致する
