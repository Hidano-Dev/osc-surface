// /sys/* プロトコルのアドレス定数。仕様は docs/UNITY_PROTOCOL.md を正とする。
// スキーマ(zod)は Phase 1 で追加する。

export const SYS = {
    PING: '/sys/ping',
    PONG: '/sys/pong',
    STATS_REQUEST: '/sys/stats/request',
    STATS: '/sys/stats',
    MANIFEST_REQUEST: '/sys/manifest/request',
    MANIFEST: '/sys/manifest',
} as const

export const SURFACE = {
    STATUS_REQUEST: '/surface/status/request',
    STATUS: '/surface/status',
    // OSC ネイティブ UI (TouchOSC 等) がエコーバック宛先として自分を登録する名乗り。
    // 引数は受信ポート(int)。省略時は送信元ポートを使う。
    HELLO: '/surface/hello',
    // 自作 UI (WebSocket クライアント) 向けのマニフェスト配信。
    // 引数は採用済みマニフェストの JSON 文字列 1 個。
    MANIFEST: '/surface/manifest',
    // 自作 UI からの再配信要求。custom module 内で消費し UDP には出さない。
    MANIFEST_REQUEST: '/surface/manifest/request',
} as const

export const SURFACE_DIAG = {
    REQUEST: '/surface/diag/request',
    SNAPSHOT: '/surface/diag',
    REACHABILITY: '/surface/diag/reachability',
    RTT: '/surface/diag/rtt',
    LOSS_RATE: '/surface/diag/loss-rate',
    SUBNET: '/surface/diag/subnet',
    MESSAGES: '/surface/diag/messages',
    LOG_USAGE: '/surface/diag/log-usage',
    PURGE: '/surface/diag/purge',
    GUARD: '/surface/diag/guard',
    SELF_HEAL: '/surface/diag/self-heal',
} as const

export const ADDRESSES = {
    SYS,
    SURFACE,
    SURFACE_DIAG,
} as const

export type SysAddress = (typeof SYS)[keyof typeof SYS]
export type SurfaceAddress = (typeof SURFACE)[keyof typeof SURFACE]
export type SurfaceDiagAddress = (typeof SURFACE_DIAG)[keyof typeof SURFACE_DIAG]
export type ProtocolAddress = SysAddress | SurfaceAddress | SurfaceDiagAddress

export * from './osc-types'
export * from './schemas'
export * from './wire'
