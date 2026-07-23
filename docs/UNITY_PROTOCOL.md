# UNITY_PROTOCOL.md — `/sys/*` プロトコル仕様(草稿)

> **状態: 草稿(Phase 0 時点)。** Phase 1〜3 の実装で詳細化し、Phase 4 で完成させる。
> 本仕様は OSC 1.0 標準の機能(基本型タグ・bundle・timetag)のみで成立させる。特定の OSC ライブラリ(uOSC 等)固有の挙動を前提にしてはならない。uOSC を使った具体例は付録に隔離する(Phase 4)。

## 前提

- Unity が真実の源(source of truth)。UI は表示キャッシュにすぎず、値の確定は常に Unity からのエコーバックによる
- トランスポートは UDP。アドレス・ポートは実行時設定(`config/surface.config.json`)で与える

## 1. 到達性・診断

| 方向 | アドレス | 引数 | 意味 |
|---|---|---|---|
| Surface → Unity | `/sys/ping` | `int seq` | 到達性確認。2 秒間隔で送信 |
| Unity → Surface | `/sys/pong` | `int seq` | `/sys/ping` 受信時に **同じ seq を即時** 返信 |
| Surface → Unity | `/sys/stats/request` | (なし) | 受信統計の要求 |
| Unity → Surface | `/sys/stats` | `string json` | 統計 JSON を返信 |

`/sys/stats` の JSON ペイロード:

```json
{ "received": 0, "parseErrors": 0, "lastReceivedAt": "ISO-8601 文字列" }
```

- Surface 側は RTT と連続喪失数を保持する(詳細は Phase 1 で規定)

## 2. マニフェストハンドシェイク

| 方向 | アドレス | 引数 | 意味 |
|---|---|---|---|
| Surface → Unity | `/sys/manifest/request` | (なし) | マニフェスト要求 |
| Unity → Surface | `/sys/manifest` | `string json` | マニフェスト返信 |

マニフェストは操作可能パラメータの宣言(スキーマは `packages/shared` の zod 定義を正とする):

```ts
{
  version: 1,
  entries: [{
    address: string,        // 例 "/avatar/blend/smile"
    label: string,          // 表示名(日本語可)例 "笑顔"
    type: "i" | "f" | "s" | "b" | "bool",
    widget: "fader" | "button" | "toggle" | "xy" | "text",
    range?: [number, number],
    default?: number | string | boolean,
    group?: string          // UI セクション分け用
  }]
}
```

- 各エントリには現在値を初期値として含め、UI 表示を Unity の実状態に同期させる
- `type` の意味:
  - `"i"` = int32、`"f"` = float32、`"s"` = string
  - `"b"` = blob(byte 配列。OSC 1.0 の `b` タグに準拠)
  - `"bool"` = 送信時に `T`/`F` タグへ変換。ただし受信ライブラリが `T`/`F` 非対応の場合に備え、config で int(0/1) 送信へのフォールバックを可能にする

## 3. 双方向同期の規律

1. UI 操作 → OSC 送信(Surface → Unity)
2. Unity が値を確定し、**同一アドレス** にエコーバック(Unity → Surface)
3. Surface はエコーバックを受けてウィジェット表示を確定
4. ドラッグ操作中のウィジェットに対する受信値は無視する(操作終了後の最終エコーバックで整合)

## 互換性ノート

- (Phase 1 以降、標準仕様と各ライブラリの差異が判明するたびここに追記する)
- 配列引数など OSC 1.0 で解釈が割れる機能は使わず、複数値は複数引数または JSON 文字列で表現する方針

## 付録(Phase 4 で執筆)

- A. uOSC による参照実装例
- B. 受信統計の持ち方(擬似コード)
- C. pong 実装(擬似コード)
- D. マニフェスト生成(擬似コード)
