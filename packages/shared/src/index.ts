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

export const ADDRESSES = {
    SYS,
    SURFACE,
} as const

export type SysAddress = (typeof SYS)[keyof typeof SYS]
export type SurfaceAddress = (typeof SURFACE)[keyof typeof SURFACE]
export type ProtocolAddress = SysAddress | SurfaceAddress

export * from './osc-types'
export * from './schemas'
