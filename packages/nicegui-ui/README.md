# oscdesk NiceGUI UI

`oscdesk_ui` は、oscdesk ブリッジの WebSocket プロトコルを利用する NiceGUI
(Python) UI です。Unity との OSC 通信は `packages/bridge` が担当し、UI は表示と
操作を担当します。値の確定は Unity のエコーバックを正とします。

このシステムは認証を提供しません。信頼できる LAN 内で利用し、インターネットや
信頼できないネットワークへ直接公開しないでください。

```
NiceGUI UI  --WebSocket-->  oscdesk bridge  --UDP OSC-->  Unity
ブラウザ   <--WebSocket--                  <--UDP OSC--
```

## 起動

通常はリポジトリ直下の `start-oscdesk.bat` または `./start-oscdesk.ps1` を使います。
ブリッジを起動してから UI を接続し、接続先 URL を表示します。デバッグ構成は
`start-oscdesk-debug.bat`、OSC ネイティブ UI の評価は
`start-oscdesk-touchosc.bat` を使います。

手動で UI だけを起動する場合は、ブリッジが待ち受けている状態で次を実行します。

```powershell
packages/nicegui-ui/.venv/Scripts/python -m oscdesk_ui
```

主なオプションは `--osc-host`、`--osc-port`、`--ui-host`、`--ui-port`、
`--client-id`、`--show-ui`、`--verbose` です。既定の UI ポートは 8080、ブリッジの
WebSocket ポートは 7080 です。

## 構成

| パス | 役割 |
|---|---|
| `src/oscdesk_ui/protocol.py` | ブリッジ WebSocket フレームのエンコード・デコード |
| `src/oscdesk_ui/surface_link.py` | ブリッジへの接続、再接続、心拍、送信キュー |
| `src/oscdesk_ui/manifest.py` | マニフェストの検証 |
| `src/oscdesk_ui/value_store.py` | 操作値の表示キャッシュとエコーバック反映 |
| `src/oscdesk_ui/state.py` | 接続、マニフェスト、表示値の状態管理 |
| `src/oscdesk_ui/widgets.py` | マニフェストから NiceGUI 部品を生成 |
| `src/oscdesk_ui/page.py` | 画面と接続状態の表示 |

案件差分はコードではなく、設定・レイアウト・マニフェストのデータで表現します。

## テスト

リポジトリ全体のテストは、ビルド、Vitest (unit / guards / e2e)、pytest の順に
ルートから実行します。

```powershell
corepack pnpm test
```

UI のテストだけを実行する場合は次を使います。

```powershell
packages/nicegui-ui/.venv/Scripts/python -m pytest packages/nicegui-ui
```

pytest のブリッジ結合テストはブラウザを使わず、ビルド済みブリッジと mock-unity
をプロセスとして起動して WebSocket と OSC の往復を検証します。
