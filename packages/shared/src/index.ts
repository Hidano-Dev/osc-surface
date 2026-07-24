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
