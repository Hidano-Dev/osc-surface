# oscdesk への移行手順

この文書は、GitHub リポジトリとローカルディレクトリを `osc-surface` から `oscdesk` へ改名するための、利用者が実施する手順です。この作業はこの文書の作成時点では実施していません。

## 作業前の確認

1. 作業中の変更をコミットするか、別の場所へ退避する。
2. Unity エディター、ブリッジ、NiceGUI UI など、このリポジトリを使用するプロセスを終了する。
3. 現在のディレクトリで remote URL とブランチを記録する。

   ```powershell
   git remote -v
   git branch --show-current
   git status --short
   ```

## GitHub リポジトリ名を変更する

1. GitHub の対象リポジトリを開く。
2. **Settings → General → Repository name** で、名前を `osc-surface` から `oscdesk` に変更して保存する。
3. GitHub のリポジトリ画面が新しい URL で開けることを確認する。
4. 旧 URL から新 URL へリダイレクトされることも確認する。リダイレクトに依存せず、以後は新 URL を使用する。

## ローカルディレクトリを変更する

リポジトリの外側へ移動してから、実際の現在パスを確認したうえでディレクトリ名を変更する。

```powershell
Set-Location ..
Rename-Item -LiteralPath .\osc-surface -NewName oscdesk
Set-Location .\oscdesk
```

IDE、ショートカット、ターミナル、Unity Hub などに旧ローカルパスを登録している場合は、新しいパスへ更新する。

## remote URL を付け替える

GitHub のアカウント名と、変更後に GitHub が表示する URL を使う。HTTPS の例は次のとおり。

```powershell
git remote set-url origin https://github.com/<アカウント名>/oscdesk.git
git remote -v
git ls-remote origin HEAD
```

SSH を使っていた場合は、同じホスト・アカウントの新しいリポジトリ名に置き換える。

```powershell
git remote set-url origin git@github.com:<アカウント名>/oscdesk.git
git remote -v
git ls-remote origin HEAD
```

次のすべてを満たせば remote の付け替えは完了である。

- `git remote -v` の fetch/push URL が新しい GitHub URL になっている。
- `git ls-remote origin HEAD` がエラーなく実行できる。
- 表示された HEAD が、改名前に記録した既定ブランチと同じである。
- GitHub の新 URL で対象リポジトリ、ブランチ、直近のコミットを確認できる。
- `git status` が意図しない変更を示さない。

## 同居する Unity プロジェクトの追従作業

Unity プロジェクトはこのリポジトリの `OscSurface/` に同居している。改名の影響範囲は、次のような「リポジトリ名またはローカルパスを文字列として参照する箇所」に限る。

- Unity Hub の登録先、IDE のワークスペース、ビルド・起動スクリプト、CI の checkout パス。
- Unity 側の README、運用メモ、テスト手順、外部ツール設定に書かれたリポジトリ URL やローカルパス。
- Unity プロジェクトを参照するショートカット、パッケージ設定、開発者ごとの環境変数。

Unity プロジェクトの namespace、Assembly Definition、シーン、Prefab、アセットの GUID、Unity のコード上の型名を、リポジトリ改名だけを理由に変更する必要はない。該当する参照だけを新しいパスまたは URL に更新し、変更前後で Unity プロジェクトが開けることを確認する。

### Unity 側実装に影響しないことの確認

内部アドレスの改名はブリッジと共有プロトコルの内部名前空間を `/surface/*` から `/oscdesk/*` に変えるものだが、Unity と外部システムの契約である `/sys/*` は変更しない。したがって、Unity 側の `/sys/*` 実装を改名・置換しないことがこの移行の前提である。

次の順に確認する。

1. Unity プロジェクト内を `/surface/`、`/oscdesk/`、`/sys/` で検索する。Unity 側にある `/surface/*` の参照があれば、内部アドレスではなくリポジトリ名・パスの参照かを切り分ける。`/sys/*` の送受信処理は変更しない。
2. Unity の OSC 受信・送信設定が、従来どおりのポート、送信先、`/sys/*` アドレス、引数型であることを確認する。
3. Unity を開いてコンパイルエラーがないことを確認し、対象シーンを再生する。
4. ブリッジへ接続し、Unity からの `/sys/ping` に対する pong、接続状態表示、既存の `/sys/*` の状態・要求応答が改名前と同じように動作することを確認する。
5. UI から値を変更し、Unity のエコーバックで値が確定することを確認する。内部 `/oscdesk/*` の通信はブリッジ内で処理され、Unity の `/sys/*` 契約を通らないこともログで確認する。

この確認で `/sys/*` のアドレス、引数、ポート、送受信方向に差分がなければ、内部アドレス改名による Unity 側実装の変更は不要である。差分が見つかった場合は、移行を完了扱いにせず、プロトコル契約の変更として切り分ける。

## 最終チェック

以下をすべて確認して移行完了とする。

- GitHub のリポジトリ名が `oscdesk` である。
- ローカルのディレクトリ名と、IDE・Unity Hub・スクリプトの参照が `oscdesk` に揃っている。
- `origin` の fetch/push URL が新しい GitHub URL で、`git ls-remote origin HEAD` が成功する。
- Unity プロジェクトが開き、コンパイルと対象シーンの再生に成功する。
- `/sys/*` の契約を変更せず、ping/pong と既存の状態・要求応答を確認できる。
- UI の値変更が Unity のエコーバックで確定する。

