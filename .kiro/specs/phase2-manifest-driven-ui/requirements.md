# Requirements Document

## Project Description (Input)
Phase 2 — マニフェスト駆動 UI。Unity(mock-unity)が /sys/manifest/request に応答して返す manifest JSON(version/entries: address, type, label, range, 初期値, group 等)を custom module が受信・zod 検証し、O-S-C のリモートコマンド(/EDIT 等)で既存レイアウトのウィジェットのラベル・レンジ・初期値を動的更新する。キャラクター名など実行時にしか決まらない値をマニフェスト経由で UI に反映し、マニフェストの現在値で UI 表示を Unity の実状態に同期させる。mock-unity に「キャラ名が毎回変わる」シナリオを持たせて E2E 検証する。案件差分はコードでなくデータ(マニフェスト/レイアウト/config)で表現する規律に従う。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
