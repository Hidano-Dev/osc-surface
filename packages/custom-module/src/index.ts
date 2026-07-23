// OscSurface custom module — O-S-C の -c/--custom-module に渡す単一バンドルのエントリ
// Phase 0: 読み込み確認のみ(フィルタは素通し)。プロトコル実装は Phase 1 以降。

import { SYS } from '@osc-surface/shared'

module.exports = {

    init() {
        console.log(`(INFO) [osc-surface] custom module loaded (sys namespace: ${Object.values(SYS).join(', ')})`)
    },

    oscInFilter(data: OscMessage) {
        return data
    },

    oscOutFilter(data: OscMessage) {
        return data
    },

}
