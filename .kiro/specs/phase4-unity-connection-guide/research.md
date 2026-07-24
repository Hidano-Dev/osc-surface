# Research & Design Decisions — phase4-unity-connection-guide

## Summary

- **Feature**: `phase4-unity-connection-guide`
- **Discovery Scope**: Extension(ドキュメント完成 + 実機検証の最小拡張。light discovery + uOSC の外部依存検証)
- **Key Findings**:
  - uOSC は npmjs スコープドレジストリ(scope `com.hecomi`)から `com.hecomi.uosc@2.2.0`(v2 系最新)として UPM 導入でき、バージョンを manifest.json に固定できる
  - uOSC v2 は `i`/`f`/`s`/`b` に加え `T`/`F`(bool、v2.1.0 以降)を実装し、文字列は UTF-8、bundle は受信時に自動展開して 1 メッセージずつ `onDataReceived`(メインスレッド)に配信する — 本プロトコルの計数規則(展開後メッセージ単位)と自然に一致する
  - uOSC はデコード失敗をイベントとして公開しない(`Debug.LogError` のみ)ため、参照実装では `parseErrors` が常に 0 になる — 本文擬似コードとの差異として互換性ノート行きが確定
  - `OscSurface/Packages/manifest.json` に uOSC は未導入。既に npmjs のスコープドレジストリ運用実績(`jp.keijiro` / `com.hidano`)があり、同じ流儀で追加できる

## Research Log

### uOSC v2 の配布形態とバージョン

- **Context**: 付録の参照実装を hecomi/uOSC v2 系・UPM 導入とするユーザー決定(再検討しない)。導入方法とバージョン固定の具体化が必要
- **Sources Consulted**: https://github.com/hecomi/uOSC (README / Releases)、https://registry.npmjs.org/com.hecomi.uosc
- **Findings**:
  - 導入方法は 3 通り: unitypackage / git URL `https://github.com/hecomi/uOSC.git#upm` / スコープドレジストリ(URL `https://registry.npmjs.com`、scope `com.hecomi`、パッケージ `com.hecomi.uosc`)
  - npm 上の最新は **2.2.0**(dist-tag latest)。リリース履歴: v2.1.0 で bool(`T`/`F`)対応、v2.0.3 で動的アドレス・ポート変更と手動 start/stop、v1.1.0 で IPv6
  - MIT ライセンス
- **Implications**: スコープドレジストリ + `"com.hecomi.uosc": "2.2.0"` の明示ピンを採用(git URL `#upm` はブランチ先端参照で再現性が劣る)。`OscSurface/Packages/manifest.json` の既存パターンと一致する

### uOSC の受信経路・型・エンコーディング(ソース確認)

- **Context**: 付録 C# が本文擬似コード(計数規則・pong 即時性・UTF-8 単一データグラム)と一致するかの事前確認
- **Sources Consulted**: uOSC master の `Runtime/Core/Parser.cs` / `Reader.cs` / `Message.cs` / `Util.cs`
- **Findings**:
  - 型タグ: 送信は `int→i`, `float→f`, `string→s`, `byte[]→b`, `bool→T/F`。受信パーサも `i f s b T F` の 6 種を認識、未知タグは黙って無視(default ケースにコメントのみ)
  - 文字列デコードは `Encoding.UTF8.GetString(...)`(UTF-8 確定)
  - bundle(`#bundle`)は受信時に再帰展開し、要素ごとに Message として配信。サイズ不正は `Debug.LogErrorFormat` でログのみ、例外は投げない
  - `onDataReceived` は Unity メインスレッドで呼ばれる(README 明記)。uOscClient は送信キューをバックグラウンドスレッドで約 1ms 間隔フラッシュ
  - 最大パケットは UDP 上限準拠。それ以上は uPacketDivision(別パッケージ)を案内 — 本プロトコルの単一データグラム制約(~1.4KB 推奨 / ~60KB 実用上限)と整合
- **Implications**:
  - bundle 自動展開 + メッセージ単位配信により、`received` の「展開後メッセージ単位の計数」は `onDataReceived` 内の単純インクリメントで仕様どおりになる(吸収コード不要)
  - デコード失敗のフックがないため `parseErrors` は uOSC 上では観測不能 → 付録に差異として明記(Req 3.4 / 互換性ノート)
  - `bool` を C# の `bool` のまま `Send` すると `T`/`F` タグになる。本プロトコルの確定挙動は `i` の 0/1 なので、参照実装は bool 値を必ず int 0/1 に正規化して送信する
  - pong の「即時返信」はメインスレッド配信のため最大 1 フレーム + 送信キュー間隔の遅延を持つ。2 秒間隔 ping・未応答 1 件保持の判定には十分速く問題ないが、RTT にフレーム時間が乗ることを付録に注記する

### mock-unity 参照実装の確定挙動(擬似コードの正)

- **Context**: 本文擬似コードは mock-unity(`packages/mock-unity/src/responder.ts` / `server.ts` / `scenario.ts`)の実証済み挙動と一致させる要件(Req 1.4)
- **Sources Consulted**: リポジトリ内ソース(responder.ts, server.ts, scenario.ts, scenarios/default.json)、docs/UNITY_PROTOCOL.md、packages/shared/src/schemas.ts
- **Findings**:
  - 受信処理の骨格: decode 失敗 → `parseErrors+1` のみで終了 / bundle は再帰展開し **展開後メッセージごとに** `received+1` と `lastReceivedAt` 更新 → その後アドレスでディスパッチ
  - `/sys/ping` → 受信 args をそのまま `/sys/pong` に載せ替えて返信(同一 `seq`)
  - `/sys/stats/request` → 自身を計数した **後に** stats JSON を作るため、`lastReceivedAt` は要求受信時刻以降になる(仕様の文言と一致)
  - `/sys/manifest/request` → 現在値ストアを `default` に埋めたマニフェスト JSON(`s` 1 引数)で応答。要求ごとに応答してよい(重複応答は Surface 側で冪等)
  - `/sys/*` のその他アドレスは計数のみで応答しない。通常メッセージは値を型チェック付きで記録し、同一アドレスへエコーバック
  - 返信先は受信データグラムの送信元ではなく `--reply-host/--reply-port`(設定)を優先する構造
  - stats の `lastReceivedAt` 初期値は epoch 0 の ISO-8601。スキーマは `z.string().datetime({ offset: true })`(`Z` またはオフセット必須)
- **Implications**: 本文擬似コードはこの骨格(decode → bundle 展開 → 計数 → ディスパッチ、設定による返信先)をそのまま言語中立に写す。付録 C# も同じ節構成で対応させる

### O-S-C / config 側の接続パラメータ対応関係

- **Context**: 実 Unity 接続手順(Req 2.1)で示すポート配線の正確な対応表が必要
- **Sources Consulted**: config/surface.config.json、docs/VERIFICATION.md(Phase 1〜3 の起動手順)、packages/shared/src/schemas.ts(SurfaceConfigSchema)
- **Findings**:
  - `unity.host:unity.sendPort`(既定 127.0.0.1:9000)= Surface → Unity の宛先。O-S-C 起動の `-s host:port` と一致必須(動的生成ウィジェットはサーバ既定ターゲットへ送るため)
  - `unity.receivePort`(既定 9001)= Unity → Surface の返信先ポート。O-S-C 起動の `-o 9001` と一致必須
  - Unity 側: OSC サーバ待受ポート = 9000(sendPort)、OSC クライアント宛先 = Surface ホスト:9001(receivePort)
- **Implications**: 手順書には「config の 2 ポート ↔ O-S-C 起動引数 ↔ Unity 側 2 コンポーネント設定」の 3 者対応表を載せる。Editor 同居(127.0.0.1)と LAN 分離(実 IP)の両ケースを示す

### OscSurface/ プロジェクトの現状

- **Context**: 疎通検証のための最小変更範囲の確定(Req 7.1 / 7.4)
- **Sources Consulted**: OscSurface/Packages/manifest.json
- **Findings**: uOSC 未導入。uloop MCP(`io.github.hatayama.uloopmcp` 3.0.0-beta.61)導入済みで、コンパイル・Play Mode 制御・ログ取得・スクリーンショットを自動化できる。npmjs スコープドレジストリの既存エントリあり
- **Implications**: 変更は (1) manifest.json への scope 追加 + 依存 1 行、(2) 参照実装 C# 1 ファイル、(3) 専用の最小シーン 1 個、に閉じる。`.meta` は Unity Editor(uloop 経由の再コンパイル)に生成させるのが基本。外部スクリプトで書く場合のみランダム 32 桁 hex GUID 規則に従う

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 擬似コードを付録 B〜D に置く(現プレースホルダどおり) | 付録 A=uOSC、B〜D=擬似コード | 既存プレースホルダと 1:1 | Req 1.1〜1.3 が「本文に」擬似コードを要求しており矛盾。本文だけで実装完結(Req 4.1)も崩れる | 不採用 |
| 擬似コードを本文 §4 に昇格、付録は uOSC のみ(採用) | 本文 §4 実装指針(擬似コード)+ §5 接続手順 + §6 チェックリスト、付録 A に uOSC 一式 | 要件と完全整合。付録を読まずに実装完結 | プレースホルダ A〜D の構成変更を明示する必要 | 「A〜D を実内容に置き換える」(Req 5.2)は構成再編を含めて満たす旨を design に記録 |
| uOSC 例を別ファイル(docs/appendix)に分離 | UNITY_PROTOCOL.md 本文 + 別 md | 本文の純度が上がる | 「受け渡し資産は UNITY_PROTOCOL.md 1 本」という Phase 0 からの前提が崩れ、配布時の欠落リスク | 不採用 |

## Design Decisions

### Decision: uOSC はスコープドレジストリ + 2.2.0 固定で導入する

- **Context**: UPM 導入(ユーザー決定)の具体化。git URL `#upm` かレジストリか
- **Alternatives Considered**:
  1. git URL `https://github.com/hecomi/uOSC.git#upm` — 手軽だがブランチ先端参照でバージョン固定が弱い
  2. スコープドレジストリ `com.hecomi` + `com.hecomi.uosc@2.2.0` — manifest.json に明示ピン
- **Selected Approach**: 2. manifest.json に `{"name":"hecomi","url":"https://registry.npmjs.com","scopes":["com.hecomi"]}` を追加し、`"com.hecomi.uosc": "2.2.0"` を依存に追加
- **Rationale**: 再現性(バージョン固定)と、既存の npmjs スコープドレジストリ運用との一貫性
- **Trade-offs**: レジストリ障害時は git URL に切替可能(手順書に代替として記載)
- **Follow-up**: 実装時に Unity Editor(uloop)でパッケージ解決とコンパイル成功を確認

### Decision: 付録の C# は依存ゼロの手書き JSON シリアライザを内蔵する

- **Context**: マニフェスト/stats の JSON 生成。`JsonUtility` は optional フィールド(`range?`/`default?`/`group?`)と union 型(`default: number|string|boolean`)を表現できず、Newtonsoft は追加依存になる
- **Alternatives Considered**:
  1. `JsonUtility` — optional 省略不可(null や 0 が必ず出てスキーマ検証で落ちる/`range` 省略不能)
  2. Newtonsoft Json(com.unity.nuget.newtonsoft-json)— 「C# 1 ファイルをそのまま流用」の自己完結性を壊す
  3. ファイル内の小さな JSON ビルダ(文字列エスケープ関数含む)— 採用
- **Selected Approach**: 3. エントリ定義から JSON を組み立てる私製ビルダを同一ファイルに置く。文字列は JSON 仕様のエスケープ(`"` `\\` 制御文字)を実装し、UTF-8 マルチバイトはそのまま通す
- **Rationale**: コピペ 1 ファイルで完結し、付録の「読み替えるだけ」要件(Req 4.2)を満たす。マニフェストのフィールド構造は固定的でビルダは小さい
- **Trade-offs**: 汎用性はないが、汎用 JSON 生成は本プロトコルの範囲外
- **Follow-up**: 生成 JSON が `ManifestSchema` / `StatsPayloadSchema` を通ることを実機検証(Surface が採用するかどうか)で確認

### Decision: bool は C# `bool` を uOSC に渡さず int 0/1 に正規化して送る

- **Context**: uOSC は `bool` を `T`/`F` タグで送るが、本プロトコルの確定挙動は `i` の 0/1(Phase 2 互換性ノート)
- **Selected Approach**: 参照実装の送信経路(エコーバック・マニフェスト外の値送信)は bool を int 0/1 へ変換してから `Send` する。受信で `T`/`F` が来た場合(他実装からの受信)は 0/1 に読み替えて記録する
- **Rationale**: Surface(O-S-C 側)は 0/1 の `i` で送受信しており、`T`/`F` を返すとプロトコル差異になる
- **Trade-offs**: uOSC の bool 対応を意図的に使わない。差異として付録に明記(Req 3.4)
- **Follow-up**: 実機でトグル操作 → エコーバックの型が `i` であることを NDJSON ログで確認可能

### Decision: 疎通検証は専用最小シーン + 1 GameObject で行う

- **Context**: OscSurface/ への変更は最小限(Req 7.4)。既存シーンの構成は本ワークスペースの管轄外
- **Selected Approach**: `Assets/OscSurfaceBridge/` に参照実装 C# と専用シーン(GameObject 1 個に uOscServer + uOscClient + Bridge)を置く。既存シーン・既存アセットには触れない
- **Rationale**: 追加のみで可逆。既存プロジェクトとの干渉ゼロ
- **Follow-up**: `.meta` 生成は Unity Editor に任せる(uloop の refresh/compile)。手書きする場合はランダム 32 桁 hex

## Risks & Mitigations

- uOSC がデコード失敗を公開せず `parseErrors` が常に 0 — 付録と互換性ノートに「uOSC の制約。統計の意味は変えない」と明記し、本文擬似コードは parseErrors 計数を正として維持
- Unity Editor の一時停止(Pause)や重いフレームで pong が遅延し喪失表示になる — 接続手順のトラブルシュートに「Editor Pause 中は喪失表示になる(正常)」を記載
- Windows ファイアウォールが Unity Editor の UDP 待受(9000)をブロック — トラブルシュート項目に受信許可の確認を記載(LAN 分離構成で特に発生)
- 付録 C# と投入ファイルの内容乖離 — 検証手順に両者の一致確認(diff)を組み込む。修正時は両方へ反映(Req 7.3)
- `lastReceivedAt` の書式ずれで `StatsPayloadSchema` 検証に落ちる — ISO-8601 UTC(`Z` 終端)を仕様として付録に固定

## References

- [hecomi/uOSC](https://github.com/hecomi/uOSC) — 参照実装ライブラリ。README(導入・API・スレッドモデル)
- [com.hecomi.uosc (npm)](https://registry.npmjs.org/com.hecomi.uosc) — UPM スコープドレジストリ配布。latest 2.2.0
- uOSC `Runtime/Core/Parser.cs` / `Reader.cs` / `Message.cs` — 型タグ・UTF-8・bundle 展開・エラー時挙動のソース確認
- `docs/UNITY_PROTOCOL.md` — Phase 1〜3 確定仕様(本フェーズで完成させる対象)
- `packages/mock-unity/src/responder.ts` — 擬似コードの正とする参照実装
- `packages/shared/src/schemas.ts` — `ManifestSchema` / `StatsPayloadSchema` の正規定義
