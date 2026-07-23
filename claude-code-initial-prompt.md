# Unity向けOSCコントロールサーフェス開発 — 初回指示

あなたにはOpen Stage Control(以下O-S-C)を基盤としたOSCクライアントシステムのパイロット実装を依頼する。以下を読み、Phase 0から順に進めること。

## プロジェクト概要

Unityアプリ(および将来的にResolume/TouchDesigner等の任意のOSC受信アプリ)をLAN内のブラウザ/スマホから操作する双方向OSCコントロールサーフェスを作る。フルスクラッチではなくO-S-Cを土台に使い、開発対象を以下に限定する:

1. **custom module**(O-S-Cのサーバー側拡張ポイント、JS)
2. **レイアウト定義**(O-S-CのウィジェットJSON)
3. **Unity側と取り決めるプロトコル仕様**(`/sys/*` 名前空間)
4. **テストハーネス**(Unityのモックを含む自動テスト)

## 絶対規律

- **O-S-C本体のソースは改造しない。** Forkはsubmoduleとして保持するが、これは将来の保険であり、現段階での変更は禁止。拡張はすべてcustom moduleとレイアウトで行う。本体改造でしか実現できない要件に当たった場合は、実装せずに私に報告し判断を仰ぐこと。
- **顧客・案件ごとの差分はコードではなくデータ(config/レイアウト/マニフェスト)で表現する。** custom moduleに案件固有のif分岐を書きたくなったら設計ミスを疑うこと。
- **Unityが真実の源(source of truth)。** UIは表示キャッシュにすぎない。値の確定は常にUnityからのエコーバックによる。
- **UnityのOSCライブラリに依存しない。** 参照実装としてはuOSC(blob対応・安定性が理由)を想定するが、導入先の会社が独自Forkを含む別ライブラリを使うケースがあるため、プロトコルはOSC 1.0標準の機能(基本型タグ・bundle・timetag)のみで成立させること。特定ライブラリ固有の拡張・アドレスマッチング挙動・型変換の癖を前提とした設計をした時点で仕様バグとみなす。判断に迷う機能(例: 配列引数の扱い)は標準仕様に寄せ、`docs/UNITY_PROTOCOL.md` に互換性ノートとして明記する。
- 各Phaseの完了時、動作確認手順を `docs/VERIFICATION.md` に追記し、自動テストを緑にしてから次へ進む。

## リポジトリ構成

pnpm workspaceで以下を構築する:

```
osc-surface/
├── CLAUDE.md                  # この文書の要約+開発コマンド一覧(あなたが作成・保守)
├── DESIGN.md                  # 設計判断の記録(あなたが作成・保守)
├── docs/
│   ├── UNITY_PROTOCOL.md      # /sys/* プロトコル仕様書(Unity実装者への受け渡し資産)
│   └── VERIFICATION.md        # 手動検証手順
├── vendor/
│   └── open-stage-control/    # Forkのgit submodule(無改造)
├── packages/
│   ├── shared/                # プロトコル型定義・zodスキーマ・定数
│   ├── custom-module/         # O-S-C custom module(ビルドして単一JSにbundle)
│   └── mock-unity/            # Unityモック(テスト・開発用OSCレスポンダ)
├── layouts/                   # O-S-Cレイアウト定義
├── config/                    # 宛先・ポート等の実行時設定(JSON)
└── tests/                     # E2E(custom module + mock-unity のループバック試験)
```

注意: O-S-Cのcustom moduleは実行時requireに制約があるため、`packages/custom-module` はesbuild等で単一ファイルにbundleしてから読み込ませる構成にすること。

## `/sys/*` プロトコル仕様(初版)

Unity側と共有する契約。詳細化して `docs/UNITY_PROTOCOL.md` に清書すること。

### 到達性・診断
- `/sys/ping (int seq)` → Unityは `/sys/pong (int seq)` を即時返信
- custom moduleは2秒間隔でpingを送信し、RTTと連続喪失数を保持
- `/sys/stats/request ()` → Unityは `/sys/stats (string json)` を返信。jsonは `{ received: int, parseErrors: int, lastReceivedAt: string }`

### マニフェストハンドシェイク
- `/sys/manifest/request ()` → Unityは `/sys/manifest (string json)` を返信
- マニフェストは操作可能パラメータの宣言。スキーマ(zodで `shared` に定義):

```ts
{
  version: 1,
  entries: [{
    address: string,        // 例 "/avatar/blend/smile"
    label: string,          // 表示名(日本語可)例 "笑顔"
    type: "i" | "f" | "s" | "b" | "bool",
    // "i"=int32, "f"=float32, "s"=string,
    // "b"=blob(byte配列。OSC仕様のタグに準拠)
    // "bool"=送信時にT/Fタグへ変換。ただし受信ライブラリがT/F非対応の
    //        場合に備え、config でint(0/1)送信へのフォールバックを可能にする
    widget: "fader" | "button" | "toggle" | "xy" | "text",
    range?: [number, number],
    default?: number | string | boolean,
    group?: string          // UIセクション分け用
  }]
}
```

- custom moduleはマニフェスト受信時、O-S-Cのリモートコマンド(`/EDIT` 等)で該当ウィジェットのラベル・レンジを動的更新する。キャラクター名など実行時にしか決まらない値はこの経路で流れる
- マニフェストには各パラメータの現在値を初期値として含め、UI表示をUnityの実状態に同期させる

### 双方向同期の規律
- UI操作 → OSC送信 → Unityが確定値を同一アドレスにエコーバック → ウィジェット表示確定
- ドラッグ操作中のウィジェットに対する受信値は無視する(操作終了後の最終エコーバックで整合)

## デバッグ要件

- デバッグモードはconfigのフラグでON/OFF。**OFF時は計測・記録処理を完全にスキップし、ホットパスにコストを残さない**
- ON時にcustom moduleが提供するもの:
  - 送受信メッセージの直近N件リングバッファ(NDJSONでのファイル書き出しはデバッグ中のみ)
  - ping/pongによる到達性・RTT・喪失率
  - 宛先IPが自ホストと同一サブネットかの静的判定(OSのインターフェース情報と照合)
  - 上記をレイアウト内の診断パネル(専用ウィジェット群)に100ms間隔の間引きで反映
- 診断パネルは通常レイアウトとは別ファイルにし、includeまたはタブで合流させる

## テスト戦略

- `packages/mock-unity`: `/sys/*` に仕様通り応答し、受け取った通常メッセージをエコーバックする小さなNode製OSCレスポンダ。実Unityなしで全機能を検証する土台
- 単体テスト(vitest): sharedのスキーマ、custom module内の純粋ロジック(診断判定・マニフェスト→EDITコマンド変換)
- E2Eテスト: O-S-Cをheadlessで起動 → mock-unityとループバック接続 → ping/pong成立、マニフェスト反映、値のエコーバック確定、を自動検証
- すべて `pnpm test` 一発で実行できること。CIを想定しヘッドレスで完結させる

## マイルストーン

**Phase 0 — 環境の素振り**
O-S-C(Fork submodule)をheadless起動し、最小レイアウト+空のcustom moduleが読み込まれることを確認。起動コマンドを `CLAUDE.md` に記録。

**Phase 1 — プロトコル基盤**
shared・mock-unity・ping/pong・statsを実装。E2Eでループバック疎通を緑にする。

**Phase 2 — マニフェスト駆動UI**
マニフェストハンドシェイクと動的ウィジェット更新。mock-unityに「キャラ名が毎回変わる」シナリオを持たせて検証。

**Phase 3 — 診断パネルとデバッグモード**
デバッグ要件一式。喪失・切断・別サブネットの各異常系をmock-unityの故障注入(応答停止等)で検証。

**Phase 4 — 実Unity接続手順書**
`docs/UNITY_PROTOCOL.md` を完成させる。本文はライブラリ非依存の擬似コード(受信統計の持ち方、pong実装、マニフェスト生成)を正とし、uOSCを使った具体例は付録に隔離する。独自Forkライブラリの利用者が「付録を読み替えるだけ」で実装できる構成にすること。

## 最初のアクション

1. リポジトリ雛形とpnpm workspaceを作成
2. O-S-CのForkをsubmoduleとして追加し、headless起動を確認(Phase 0)
3. 進める中で本プロンプトと矛盾する事実(O-S-Cの仕様上不可能な点など)を発見したら、回避策を勝手に実装せず、選択肢を添えて報告すること

不明点があればPhase開始前に質問すること。
