# Requirements Document

## Project Description (Input)
レイアウト規約の構造的強制。現在 custom module はレイアウト規約違反(dynamic コンテナ欠落、手動ウィジェットの dyn プレフィックス使用)を起動時に警告ログで通知するだけで、人間が気を付けて守る運用になっている。これを構造的に不可能にする。(1) dyn プレフィックス予約規約の撤廃: buildApplyPlan が生成ウィジェット ID を layout index の既存 ID と照合し、衝突時はサフィックス付与で一意化する。手動ウィジェットはどんな ID でも安全になり、予約プレフィックス規約と関連する警告・検証を廃止する。(2) dynamic コンテナの自己修復: マニフェスト適用時に dynamic コンテナがレイアウトに存在しない場合、custom module が root への /EDIT でコンテナを注入して生成ウィジェットの受け皿を復活させる。O-S-C 本体は無改造のまま custom module 内で完結させる。既存の layout-convention 検証・テスト(layout-convention.ts / layout-convention.test.ts)は新しい責務分担に合わせて再編する。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
