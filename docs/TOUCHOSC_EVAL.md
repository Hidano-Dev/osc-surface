# TouchOSC 評価手順

ブラウザ UI の代わりに **TouchOSC を UI として使う**構成を、購入前に手触りで評価するための手順。

O-S-C 本体は無改造のまま、OSC I/O と custom module のホストとしてのみ使う(案 A)。
接続仕様の全体像は `docs/CUSTOM_UI_INTEGRATION.md` を参照。

## 1. この構成でできること・できないこと

| | |
|---|---|
| できる | フェーダー等の操作 → Unity へ到達。Unity のエコーバック → TouchOSC の表示へ反映(双方向) |
| できる | ページ(タブ)分割、ウィジェット種別の自由な選択、レイアウトの作り込み |
| できる | ブラウザ UI との併用。両方を開くと片方の操作がもう片方にも反映される |
| **できない** | **マニフェストからの UI 自動生成**。TouchOSC の Lua は実行時にコントロールを生成/削除できないため、レイアウトは人間がエディタで作る |

「値に対してウィジェット種別を UI 側で決めたい」という要望は、TouchOSC ではレイアウトを手で作る以上
**自動的に満たされる**(Unity 側の `widget` 指定は無視され、UI 側の設計がそのまま通る)。

## 2. 起動

`start-touchosc-eval.bat` をダブルクリックする(または `.\start-touchosc-eval.ps1`)。

- 未ビルドなら custom module と mock-unity を自動でビルドする(初回のみ数十秒)
- mock-unity と O-S-C サーバーをまとめて起動する
- TouchOSC に入力すべき **IP アドレスとポートを画面に表示する**
- ウィンドウを閉じると両方停止する

| 用途 | 既定値 | 変更方法 |
|---|---|---|
| OSC 受信(TouchOSC → サーフェス) | `7091` | `-OscInPort` |
| mock-unity 待受(サーフェス → Unity) | `7090` | `-UnityPort` |
| ブラウザ UI(比較用) | `7080` | `-HttpPort` |

```powershell
# 例: ポートを変えて起動し、ビルドもやり直す
.\start-touchosc-eval.ps1 -OscInPort 8091 -Rebuild
```

使用する設定とシナリオ:

- `config/surface.touchosc.config.json` — `oscUi.enabled: true`
- `packages/mock-unity/scenarios/touchosc-eval.json` — Face / Stage / Motion / Info の 4 グループ、
  型は f / bool / i / s、レンジは `0..1` `0..255` `-180..180` `0.25..2` と意図的にばらしてある

## 3. TouchOSC 側の設定

### 3-1. 接続設定(IP の入力場所)

1. TouchOSC を開き、**ツールバーの鎖(チェーン)アイコン**を押して Connections ウィンドウを開く
2. **OSC タブ**に切り替える
3. **Connection 1 の左のチェックボックスを ON** にする(これを忘れると何も送信されない)
4. 右上の矢印ボタンで詳細を展開し、以下を設定する

| フィールド | 値 |
|---|---|
| **Type** | `UDP` |
| **Host** | ランチャーが `->` を付けて表示した PC の IP アドレス |
| **Send Port** | `7091`(サーフェスの OSC 受信ポート) |
| **Receive Port** | 任意。以下では `9000` とする |
| **Zeroconf** | `Disabled` のままでよい |

補足:

- Host 欄の横の **Browse** ボタンで、ネットワーク上の OSC 受信先を一覧できる
- **Network Info**(i アイコン)を押すと **TouchOSC 側の全ネットワークインターフェースの IP** が出る。
  PC 側とタブレット側で **前 3 オクテットが一致しているか**の確認に使える
- 設定後、エディタのツールバーの **▶(Play)ボタン**、またはデスクトップ版なら `Ctrl/Cmd + E` で
  コントロールサーフェスモードに入る。**編集モードのままでは OSC は飛ばない**

同じ PC で TouchOSC のデスクトップ版を動かす場合も、Host は `127.0.0.1` で問題ない
(サーフェス側は Unity 判定を先に行うので、同居していても取り違えない)。

### 3-2. 名乗り(エコーバックを受け取るために必須)

UDP には接続の概念がないため、サーフェス側は TouchOSC の IP と受信ポートを知らない。
**起動後に一度だけ**、以下のメッセージを送る。

```
/surface/hello  <Receive ポート:int>
```

例: Receive ポートが 9000 なら `/surface/hello 9000`。

引数を省略した場合は送信元ポートが宛先として使われるが、TouchOSC の送信元ポートは
受信ポートと異なる一時ポートになるため、**引数は明示すること**。

送り方は 2 通り。

**(a) ボタンを 1 つ置く(手軽・推奨)**

`Hello` という名前のボタンを置き、OSC メッセージを次のように設定する。

- Address: `/surface/hello`
- Argument 1: Constant / Integer / `9000`

評価中はアプリを開いたらこのボタンを 1 回押す。

**(b) ドキュメントのスクリプトで自動化**

ルートのスクリプトに `init()` を書き、起動時に自動送信する。
成功するとサーバーのコンソールに次のログが出る。

```
(INFO, CUSTOM MODULE) OSC UI peer registered: 192.168.0.50:9000
```

登録は無期限で保持され(`peerTtlMs: 0`)、操作が続く限り生き続ける。
サーバーを再起動した場合は名乗り直しが必要。

### 3-3. コントロールの作成

`packages/mock-unity/scenarios/touchosc-eval.json` の `address` をそのまま
TouchOSC のコントロールの OSC アドレスに設定する。

| アドレス | 型 | レンジ | グループ |
|---|---|---|---|
| `/avatar/blend/smile` | f | 0 – 1 | Face |
| `/avatar/blend/blink` | f | 0 – 1 | Face |
| `/avatar/look/target` | f | -1 – 1 | Face(XY 想定) |
| `/stage/light/intensity` | f | 0 – 255 | Stage |
| `/stage/camera/yaw` | f | -180 – 180 | Stage |
| `/stage/fog/enabled` | bool | — | Stage |
| `/motion/wave` | i | — | Motion |
| `/motion/jump` | i | — | Motion |
| `/motion/speed` | f | 0.25 – 2 | Motion |
| `/avatar/text/name` | s | — | Info |

**評価の要点**は、この 4 グループを **TouchOSC の Pager(タブ)で分割**してみること。
現行のブラウザ UI で不足していた点なので、ここが最も比較になる。

**送受信の両方を有効にする**こと。同じアドレスで受信も設定しておくと、Unity 側の値変化が
コントロールに反映される(= 双方向の確認になる)。

TouchOSC のフェーダーは既定で 0–1 なので、`0..255` や `-180..180` のレンジは
コントロール側のスケーリング設定で合わせる。ここの手間も評価対象。

## 4. 動作確認

1. TouchOSC でフェーダーを動かす
2. サーバーのコンソールに送受信ログが出る(`debug: true` のため)
3. **フェーダーから指を離しても値が戻らない**ことを確認する
   → mock-unity がエコーバックした値で確定している
4. ブラウザ UI(`http://localhost:7080`)を同時に開くと、TouchOSC の操作が反映される。逆も同様

うまくいかない場合:

| 症状 | 原因 |
|---|---|
| そもそも何も送信されない | Connection 1 のチェックボックスが OFF。または編集モードのまま(▶ を押す) |
| Unity に届かない | 名乗りを送っていない。`/surface/hello <受信ポート>` を送る |
| 届くがエコーバックが来ない | 名乗りの引数ポートと TouchOSC の **Receive Port** が不一致 |
| 何も動かない | Host の IP が別セグメント。TouchOSC の **Network Info** で前 3 オクテットを突き合わせる |
| 何も動かない | Windows ファイアウォールが UDP を遮断。Node.js の受信を許可する |
| `Received /surface/hello but oscUi is disabled` | 設定が読まれていない。ランチャー経由で起動しているか確認 |

### 新しい PC で起動したときのエラー

以下は**いずれも修正済み**。古い状態のまま動かしている場合の参考として残す。

| ログ | 対応 |
|---|---|
| `Could not create config folder: ...\open-stage-control\Config` | O-S-C 本体が非再帰 mkdir を使うのが原因。ランチャーと `setup-osc-surface.ps1` が事前に作成する |
| `ENOENT: scandir '...\logs\diagnostics'` | NDJSON ディレクトリは初回書き込み時に遅延作成されるため起動時は存在しない。未作成を 0 件として扱うよう修正済み |

## 5. 実装の所在

| 対象 | 場所 |
|---|---|
| ルーティング判定(純粋ロジック) | `packages/custom-module/src/osc-ui-router.ts` |
| custom module への配線 | `packages/custom-module/src/module-runtime.ts` |
| 設定スキーマ(`oscUi`) | `packages/shared/src/schemas.ts` |
| E2E(TouchOSC 役の UDP クライアントで往復) | `tests/e2e/osc-native-ui.e2e.test.ts` |

`oscUi.enabled` が `false`(既定)のときはルーターが生成されず、
従来のブラウザ + WebSocket 構成と完全に同じ挙動になる。

## 6. 評価後の判断材料

TouchOSC を採用する場合、マニフェスト駆動の自動生成をどう扱うかを決める必要がある。

- **(あ) 諦める** — レイアウトは人間が作る。マニフェストは仕様書と誤接続ガードの役割に降格
- **(い) レイアウトを生成する** — `.tosc` は XML ベースなので、マニフェストから
  プログラム生成して配布し直す運用にする(Python の `tosclib` 等)。
  ただし「Unity を起動したら UI が自動で変わる」ではなく「ファイルを配り直して開き直す」になる

なお現行のブラウザ UI 側の不満のうち、**タブ分割とウィジェット種別の決定権は
O-S-C を使ったままでも解消できる**可能性がある。詳細は `HANDOVER.md` の「学び」を参照。
