# TouchOSC 評価手順

ブラウザ UI の代わりに **TouchOSC を UI として使う**構成を、購入前に手触りで評価するための手順。

ブリッジが OSC I/O と Unity との中継を担当する。接続仕様の全体像は
`docs/UNITY_PROTOCOL.md` と `protocol/` を参照。

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

`start-oscdesk-touchosc.bat` をダブルクリックする(または `.\start-oscdesk-touchosc.ps1`)。

- 事前にセットアップとビルドを済ませ、ブリッジと mock-unity を起動する
- TouchOSC に入力すべき **IP アドレスとポートを画面に表示する**
- ウィンドウを閉じると両方停止する

| 用途 | 既定値 | 確認方法 |
|---|---|---|
| OSC 受信(TouchOSC → ブリッジ) | `7091` | 起動コンソールの `OSC 受信ポート` |
| mock-unity 待受(ブリッジ → Unity) | `7090` | `start-oscdesk-touchosc.ps1` の評価環境 |
| ブリッジ WebSocket | `7080` | `config/oscdesk.touchosc.config.json` |

> **Unity は Play モードにしないこと。**
> この評価入口は **mock-unity を「Unity 役」として起動**する。Unity と mock-unity は
> 同じポート(既定 `7090`)を使うため、同時に動かすと奪い合いになる。

```powershell
# PowerShell から起動する場合
.\start-oscdesk-touchosc.ps1
```

使用する設定とシナリオ:

- `config/oscdesk.touchosc.config.json` — `oscUi.enabled: true`
- `packages/mock-unity/scenarios/touchosc-eval.json` — Face / Stage / Motion / Info の 4 グループ、
  型は f / bool / i / s、レンジは `0..1` `0..255` `-180..180` `0.25..2` と意図的にばらしてある

## 3. TouchOSC 側の設定

### 3-1. 接続設定(IP の入力場所)

1. `start-oscdesk-touchosc.bat` を起動し、コンソールの **TouchOSC の送信先 IP:** の下に表示されたアドレスを確認する。複数表示された場合は、TouchOSC を接続する LAN と同じインターフェースのアドレスを選ぶ
   - PowerShell で後から確認する場合は `Get-NetIPAddress -AddressFamily IPv4` を実行し、`127.0.0.1` 以外の IPv4 アドレスを調べる
2. TouchOSC を開き、**ツールバーの鎖(チェーン)アイコン**を押して Connections ウィンドウを開く
3. **OSC タブ**に切り替える
4. **Connection 1 の左のチェックボックスを ON** にする(これを忘れると何も送信されない)
5. 右上の矢印ボタンで詳細を展開し、以下を設定する

| フィールド | 値 |
|---|---|
| **Type** | `UDP` |
| **Host** | ランチャーの **TouchOSC の送信先 IP:** に表示された PC の IP アドレス |
| **Send Port** | ランチャーに表示された OSC 受信ポート(既定 `7091`) |
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

### 3-2. 名乗りの送信先を書き換える(エコーバックを受け取るために必須)

UDP には接続の概念がないため、サーフェス側は TouchOSC の IP と受信ポートを知らない。
**起動後に一度だけ**、以下のメッセージを送る。

既存の TouchOSC ドキュメントを移行する場合は、名乗り用コントロールの送信先を
旧アドレスから新アドレスへ書き換える。これは `D-7` によりユーザーが TouchOSC 側で
行う必要がある作業であり、ブリッジ側で自動移行は行わない。

```
/oscdesk/hello  <Receive ポート:int>
```

例: Receive ポートが 9000 なら `/oscdesk/hello 9000`。

引数を省略した場合は送信元ポートが宛先として使われるが、TouchOSC の送信元ポートは
受信ポートと異なる一時ポートになるため、**引数は明示すること**。

送り方は 2 通り。

**(a) ボタンを 1 つ置く(手軽・推奨)**

`Hello` という名前のボタンを置き、OSC メッセージを次のように設定する。

- Address: `/oscdesk/hello`
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

### 3-3. 最初の 1 個を作る(まずここから)

**TouchOSC はレイアウトを自動生成しない。** マニフェストを受け取っても画面には何も出ない。
新規ドキュメントのまま ▶ を押すと**コントロールサーフェスが真っ暗になる**が、これは正常で
「まだ何も置いていない」という意味。

疎通を最短で確かめる手順:

1. `Ctrl/Cmd + E`(またはツールバーの ● ボタン)で**エディタに戻る**
2. **キャンバスの空き領域を右クリック**(モバイルは長押し)して **Create** メニューを開き、**Fader** を選ぶ
   - ツールバーの **Add control** ボタンでも同じ
3. 置いたフェーダーを選択し、右パネルの **Messages** セクションを開く
4. **+ ボタンで OSC メッセージを追加**する
5. **Address** を組み立てる。Address は partial(構成要素)を並べる方式なので、
   **CONSTANT** partial に `/avatar/blend/smile` のパスを入れる
   (セグメントごとに分ける必要がある場合は + で CONSTANT を足して `avatar` / `blend` / `smile` とする)
6. **Arguments** に **VALUE** partial を 1 つ追加する(フェーダーの値そのもの)
7. **Send** と **Receive** を両方 **ON** にする。**Feedback は OFF のまま**にしておく
   (受信で値が変わったときに再送させないため。ONにするとループする)
8. `Ctrl/Cmd + E` で ▶ コントロールサーフェスモードへ

最初の 1 個に `/avatar/blend/smile` を勧める理由は、**レンジが 0–1 で TouchOSC のフェーダーの
既定値と一致する**ため。スケーリング設定をしなくてもそのまま試せる。

うまくいけば、フェーダーを動かして指を離しても**値が戻らない**。
これは mock-unity がエコーバックした値で確定しているということ。

### 3-4. 残りのコントロール

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
| **▶ を押すと画面が真っ暗** | レイアウトが空。TouchOSC は UI を自動生成しないので、3-3 の手順でコントロールを置く |
| そもそも何も送信されない | Connection 1 のチェックボックスが OFF。または編集モードのまま(▶ を押す) |
| 値がすぐ 0 に戻る / 暴れる | Messages の **Feedback** が ON になっている。OFF にする |
| Unity に届かない | 名乗りを送っていない。`/oscdesk/hello <受信ポート>` を送る |
| 届くがエコーバックが来ない | 名乗りの引数ポートと TouchOSC の **Receive Port** が不一致 |
| 何も動かない | Host の IP が別セグメント。TouchOSC の **Network Info** で前 3 オクテットを突き合わせる |
| 何も動かない | Windows ファイアウォールが UDP を遮断。Node.js の受信を許可する |
| `Received /oscdesk/hello but oscUi is disabled` | 設定が読まれていない。`start-oscdesk-touchosc` 経由で起動しているか確認 |

## 5. 実装の所在

| 対象 | 場所 |
|---|---|
| OSC ネイティブ UI ルーティング | `packages/bridge/src/` |
| ブリッジ設定スキーマ(`oscUi`) | `packages/shared/src/schemas.ts` |
| E2E(TouchOSC 役の UDP クライアントで往復) | `tests/e2e/osc-native-ui.e2e.test.ts` |

`oscUi.enabled` が `false`(既定)のときはルーターが生成されず、
従来のブラウザ + WebSocket 構成と完全に同じ挙動になる。

## 6. 評価後の判断材料

TouchOSC を採用する場合、マニフェスト駆動の自動生成をどう扱うかを決める必要がある。

- **(あ) 諦める** — レイアウトは人間が作る。マニフェストは仕様書と誤接続ガードの役割に降格
- **(い) レイアウトを生成する** — `.tosc` は XML ベースなので、マニフェストから
  プログラム生成して配布し直す運用にする(Python の `tosclib` 等)。
  ただし「Unity を起動したら UI が自動で変わる」ではなく「ファイルを配り直して開き直す」になる

なお **タブ分割とウィジェット種別の決定権**は、NiceGUI 版 UI 側の実装で解消できる
論点であり、TouchOSC 採用の可否とは独立して検討できる。
