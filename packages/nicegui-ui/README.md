# @osc-surface/nicegui-ui

O-S-C 本体を無改造のまま **OSC I/O + WebSocket + custom module ホスト**としてのみ使い、
画面を NiceGUI(Python)で置き換えたコントロールサーフェス。

接続仕様は `docs/CUSTOM_UI_INTEGRATION.md`、値の扱いの規律は `CLAUDE.md` を正とする。

```
NiceGUI (:8080)  --WebSocket-->  O-S-C (:7080)  --UDP OSC-->  Unity (:7090)
   ブラウザ       <--WebSocket--  custom module  <--UDP OSC--        (:7091)
```

## 起動

リポジトリ直下の `start-nicegui-ui.bat` をダブルクリックする(O-S-C の起動・Python 仮想環境の
作成まで面倒を見る)。手で動かす場合は以下。

```powershell
# 1. O-S-C を headless で起動(別ウィンドウ)
node vendor/open-stage-control/app -n --no-qrcode -p 7080 -o 7091 -c packages/custom-module/dist/osc-surface.js

# 2. Python 環境(初回のみ)
py -3 -m venv packages/nicegui-ui/.venv
packages/nicegui-ui/.venv/Scripts/python -m pip install -e "packages/nicegui-ui[dev]"

# 3. NiceGUI
packages/nicegui-ui/.venv/Scripts/python -m osc_surface_ui --osc-port 7080 --ui-port 8080
```

スマホから使う場合は同一 LAN で `http://<PC の IP>:8080` を開く。

### 主なオプション

| オプション | 既定 | 意味 |
|---|---|---|
| `--osc-host` / `--osc-port` | `127.0.0.1` / `7080` | O-S-C の HTTP / WebSocket |
| `--ui-host` / `--ui-port` | `0.0.0.0` / `8080` | NiceGUI の待ち受け |
| `--client-id` | `nicegui-ui` | WebSocket の clientId |
| `--auth` | (空) | O-S-C を `--authentication` 付きで動かした場合の `user:password` |
| `--config` | `config/surface.config.json` | Unity の宛先を読む設定ファイル |

Unity の宛先(`unity.host` / `unity.sendPort`)と誤接続ガード(`expectedProjectId`)は
custom module と同じ `config/surface.config.json` を共有する。

## 構成

| ファイル | 役割 |
|---|---|
| `protocol.py` | WebSocket フレームの組み立て・解釈(`open` / `sendOsc` / `receiveOsc` / `ping`) |
| `surface_link.py` | 接続・再接続・`ping` 応答・送信キュー |
| `manifest.py` | マニフェストの検証(`packages/shared/src/schemas.ts` の zod と対応) |
| `value_store.py` | 値の調停(操作中はローカル / 離したらエコーバック)と送信の間引き |
| `state.py` | 上記をまとめたプロセス唯一の状態 |
| `widgets.py` | エントリ 1 件 → NiceGUI 部品 |
| `page.py` | ページ組み立てと 20Hz の同期タイマー |

## テスト

```powershell
packages/nicegui-ui/.venv/Scripts/python -m pytest packages/nicegui-ui
```

`tests/stub_server.py` が O-S-C の WebSocket 面(`open` 受理 / `ping` 送出 / `receiveOsc`
ブロードキャスト)を再現するので、vendor submodule なしで結合部分まで検証できる。
