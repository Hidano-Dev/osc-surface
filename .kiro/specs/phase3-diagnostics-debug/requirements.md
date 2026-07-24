# Requirements Document

## Project Description (Input)
Phase 3 — 診断パネルとデバッグモード。O-S-C custom module にデバッグモード(config フラグで ON/OFF、OFF 時は計測・記録処理を完全スキップしホットパスにコストを残さない)を実装する。ON 時の提供機能: 送受信メッセージの直近N件リングバッファ(NDJSON ファイル書き出しはデバッグ中のみ)、ping/pong による到達性・RTT・喪失率、宛先 IP が自ホストと同一サブネットかの静的判定(OS のインターフェース情報と照合)、これらをレイアウト内の診断パネル(専用ウィジェット群)へ 100ms 間隔の間引きで反映。診断パネルは通常レイアウト(layouts/main.json)とは別ファイルにし、include またはタブで合流させる。検証: 喪失・切断・別サブネットの各異常系を mock-unity の故障注入(応答停止等)で再現し、単体テスト(vitest: 診断判定ロジック)と E2E(O-S-C headless + mock-unity ループバック)で自動検証する。O-S-C 本体(vendor/open-stage-control)は無改造のまま。

## Introduction
本仕様は OSC Surface の Phase 3「診断パネルとデバッグモード」の要件を定義する。custom module に config フラグで切り替え可能なデバッグモードを導入し、有効時のみ送受信メッセージの記録、到達性・RTT・喪失率の診断指標の集計、宛先サブネットの静的判定を行い、これらを専用レイアウトの診断パネルへ間引き反映する。無効時は診断専用の処理を完全にスキップし、通常運用のホットパスにコストを残さない。異常系(喪失・切断・別サブネット)は mock-unity の故障注入で再現し、vitest 単体テストと E2E で自動検証する。

## Boundary Context
- **In scope**: custom module のデバッグモード制御、送受信メッセージのリングバッファと NDJSON 書き出し、ping/pong に基づく診断指標の集計、宛先サブネットの静的判定、診断パネル用レイアウト定義とその表示反映、mock-unity の故障注入、単体・E2E テスト
- **Out of scope**: O-S-C 本体(`vendor/open-stage-control`)の改変、Phase 1/2 で確定済みの `/sys/*` プロトコル仕様(`docs/UNITY_PROTOCOL.md`)自体の変更、実 Unity への接続手順(Phase 4)、能動的なネットワークプローブ(ARP/ICMP 等)による疎通探索
- **Adjacent expectations**: ping/pong の送信間隔・喪失判定・RTT 確定の基礎挙動は Phase 1 実装(`docs/UNITY_PROTOCOL.md` §1)をそのまま利用する。Unity が真実の源であり、診断パネルは表示専用とする

## Requirements

### Requirement 1: デバッグモードの構成制御
**Objective:** 運用者として、config フラグでデバッグモードを ON/OFF したい。通常運用時に計測・記録のコストを一切残さず、必要なときだけ診断機能を有効化するため。

#### Acceptance Criteria
1. The custom module shall 実行時設定(`config/surface.config.json` の `debug` フラグ)によってデバッグモードの有効・無効を決定する
2. While デバッグモードが無効な間, the custom module shall 診断専用の処理(メッセージ記録・診断指標の集計・NDJSON 書き出し・診断パネルへの反映)を送受信ホットパス上で一切実行しない
3. While デバッグモードが無効な間, the custom module shall Phase 1/2 の既存機能(ping/pong・stats・マニフェストハンドシェイク・値同期)を従来どおり提供する
4. When 起動した, the custom module shall デバッグモードの有効・無効をログに出力する

### Requirement 2: 送受信メッセージの記録(リングバッファと NDJSON 書き出し)
**Objective:** 開発者として、直近の送受信メッセージを記録・保存したい。通信異常の発生時に何が送られ何が届いたかを事後解析するため。

#### Acceptance Criteria
1. While デバッグモードが有効な間, when OSC メッセージを送信または受信した, the custom module shall 方向(送信/受信)・時刻・アドレス・引数を含む記録をリングバッファへ追加する
2. The custom module shall リングバッファの保持件数を直近 N 件(N は設定可能で既定値を持つ)に制限し、上限超過時は最古の記録から破棄する
3. While デバッグモードが有効な間, the custom module shall 記録を NDJSON 形式(1 記録 = 1 行の JSON)でファイルへ書き出す
4. While デバッグモードが無効な間, the custom module shall NDJSON ファイルの生成・書き出しを一切行わない
5. If NDJSON ファイルの書き出しに失敗した, then the custom module shall エラーをログに出力し、OSC の送受信処理を中断せずに継続する

### Requirement 3: 到達性・RTT・喪失率の診断指標
**Objective:** 運用者として、Unity への到達性と通信品質を数値で把握したい。「繋がっていない」状態とその程度を推測ではなく計測で判断するため。

#### Acceptance Criteria
1. While デバッグモードが有効な間, the custom module shall Phase 1 の ping/pong の結果から到達性(到達/喪失)・RTT・喪失率を診断指標として集計する
2. When 保持中の seq と一致する pong を受信した, the custom module shall その時点の RTT を診断指標として確定し、到達性を「到達」と判定する
3. If 連続喪失数が 1 以上である, then the custom module shall 到達性を「喪失」と判定する
4. The custom module shall 喪失率を直近の一定観測窓(既定の ping 送信回数ベース)における喪失数の割合として算出する
5. The custom module shall 診断指標の集計において `docs/UNITY_PROTOCOL.md` §1 の ping/pong 仕様(2 秒間隔・未応答 ping は最大 1 件保持・不一致 seq の破棄)を変更せずに利用する

### Requirement 4: 宛先サブネットの静的判定
**Objective:** 運用者として、宛先 IP の設定ミス(自ホストと別サブネット)を接続試行の前に検出したい。LAN 内運用で最も典型的な「宛先設定の取り違え」を早期に気付けるようにするため。

#### Acceptance Criteria
1. While デバッグモードが有効な間, when 起動時または宛先設定の読み込み時, the custom module shall OS のネットワークインターフェース情報(アドレスとサブネットマスク)を取得し、宛先 IP がいずれかの自ホストインターフェースと同一サブネットに属するかを判定する
2. If 宛先 IP がいずれのインターフェースとも同一サブネットに属さない, then the custom module shall 判定結果を「別サブネットの疑いあり」として診断パネルに提示する
3. When 宛先 IP がループバックアドレスである, the custom module shall 判定結果を「同一ホスト」として扱う
4. The custom module shall サブネット判定を OS のインターフェース情報との静的な照合のみで行い、判定のためのネットワーク送信(プローブ等)を行わない

### Requirement 5: 診断パネル(専用レイアウトと表示反映)
**Objective:** 操作者として、ブラウザ上の診断パネルで通信状態を一目で確認したい。通常の操作レイアウトを汚さずに、必要なときだけ診断表示を合流させるため。

#### Acceptance Criteria
1. The プロジェクト shall 診断パネルのレイアウト定義を通常レイアウト(`layouts/main.json`)とは別ファイルとして提供する
2. The プロジェクト shall 診断パネルを include またはタブによって通常レイアウトへ合流できる構成にする
3. While デバッグモードが有効な間, the custom module shall 診断指標(到達性・RTT・喪失率・サブネット判定結果・直近の送受信メッセージ)を診断パネルの専用ウィジェット群へ反映する
4. The custom module shall 診断パネルへの反映を 100ms 間隔の間引きで行い、更新イベントが集中しても 100ms あたり 1 回を超えて更新を送信しない
5. While デバッグモードが無効な間, the custom module shall 診断パネルへの更新送信を行わない
6. The custom module shall 診断パネルへの反映を表示専用とし、その反映によって Unity への OSC 送信を発生させない

### Requirement 6: 異常系の故障注入と自動検証
**Objective:** 開発者として、喪失・切断・別サブネットの各異常系を再現可能な形で自動検証したい。診断機能そのものの正しさを回帰テストで担保するため。

#### Acceptance Criteria
1. The mock-unity shall 応答停止等の故障注入によって喪失・切断状態を再現する手段を提供する
2. The テストスイート shall 診断判定ロジック(喪失判定・喪失率算出・サブネット判定・リングバッファ・間引き)を vitest の単体テストで検証する
3. The テストスイート shall O-S-C headless + mock-unity のループバック構成による E2E テストで、正常時および故障注入時(喪失・切断)の診断パネル表示を検証する
4. The テストスイート shall 別サブネット判定ロジックの網羅的な検証を、実ネットワーク構成に依存しない形(インターフェース情報と宛先の組み合わせを入力とする単体テスト)で行う
5. The テストスイート shall 例示用に予約された IP アドレス帯(TEST-NET、例: `203.0.113.0/24`)を宛先に設定した構成で O-S-C headless を起動する E2E テストにより、診断パネルに「別サブネットの疑いあり」の判定結果が表示されることを検証する
6. When Phase 3 の実装が完了した, the プロジェクト shall `docs/VERIFICATION.md` に手動検証手順を追記する

### Requirement 7: 開発規律の遵守
**Objective:** プロジェクト管理者として、Phase 3 の実装がプロジェクトの絶対規律を守ることを保証したい。将来の upstream 追従と案件展開を阻害しないため。

#### Acceptance Criteria
1. The プロジェクト shall `vendor/open-stage-control`(lockfile 含む)を一切改変せずに Phase 3 の全機能を実現する
2. If O-S-C 本体の改造でしか実現できない要件が判明した, then the 開発チーム shall 独断で実装せず、差分と選択肢を記録してユーザーの判断を仰ぐ
3. The プロジェクト shall デバッグモードのフラグやリングバッファ件数などの案件差分をコードではなくデータ(config・レイアウト)で表現する
