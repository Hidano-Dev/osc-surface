# UNITY_PROTOCOL.md - `/sys/*` プロトコル仕様(暫定版)

> 互換性ノートを含む仕様書。Phase 0 時点の初版に対し、Phase 1 の実装内容を反映して詳細化した。Phase 4 で実 Unity 向けの実装例を追記する。
> 本仕様は OSC 1.0 標準の機能(基本型タグ・bundle・timetag)のみで成立させる。特定の OSC ライブラリ(uOSC 等)固有の挙動を前提にしてはならない。uOSC を使った具体例は付録に隔離する(Phase 4)。

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

マニフェストの想定スキーマ(正規定義は `packages/shared` の zod スキーマを参照する):

```ts
{
  version: 1,
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

- 各エントリには現在値を初期値として含め、UI 表示を Unity の実状態に同期させる。
- `type` の意味:
  - `"i"` = int32、`"f"` = float32、`"s"` = string
  - `"b"` = blob(byte array。OSC 1.0 の `b` タグに対応)
  - `"bool"` = 送信時に `T`/`F` タグへ変換する。ただし受信ライブラリが `T`/`F` 非対応の場合に備え、config で int(0/1) 送信へのフォールバックを可能にする

## 3. 双方向同期の規律

1. UI 操作 -> OSC 送信(Surface -> Unity)
2. Unity が値を確定し、**同一アドレス** にエコーバック(Unity -> Surface)
3. Surface はエコーバックを受けてウィジェット表示を確定する
4. ドラッグ操作中のウィジェットに対する受信値は無視する。操作終了後の最終エコーバックで整合する

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

## 付録(Phase 4 で執筆)

- A. uOSC による参照実装例
- B. 受信統計の持ち方(擬似コード)
- C. pong 実装(擬似コード)
- D. マニフェスト生成(擬似コード)
