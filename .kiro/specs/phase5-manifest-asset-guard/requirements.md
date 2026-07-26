# Requirements Document

## Project Description (Input)
マニフェストの資産化と誤接続ガード。目的は 2 つ。(1) Unity 側のマニフェスト定義(公開する操作エントリの一覧)を、現在の OscSurfaceBridge.cs 内のハードコード配列(EntryDefs)から独立したファイルアセット(ScriptableObject または JSON アセット)へ外出しし、Scene/Prefab に埋め込まず Git 管理・別プロジェクトへの流用が可能な形にする。(2) ネットワーク内で誤って別プロジェクトの Unity を起動した場合に、本番運用中の OSC コントロールサーフェス UI がそのマニフェストで上書き再生成されない誤接続ガードを導入する。具体的にはマニフェストにプロジェクト識別子を追加し、Surface 側(custom module)の config に期待する識別子を設定して、不一致のマニフェストは拒否・診断ログに記録する。プロトコルのスキーマ変更(packages/shared)を伴うため version の互換性判断が必要。影響範囲: packages/shared のスキーマ、packages/custom-module の受信・採用ロジック、packages/mock-unity のシナリオ、OscSurface/ の参照実装(OscSurfaceBridge.cs)と付録 A、docs/UNITY_PROTOCOL.md、E2E テスト。絶対規律(O-S-C 本体無改造・Unity が真実の源・特定 OSC ライブラリ非依存)は維持する。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
