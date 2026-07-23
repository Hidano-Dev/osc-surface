// O-S-C custom module 実行コンテキストのグローバル宣言
// 参照: vendor/open-stage-control/resources/docs/docs/custom-module/custom-module.md

type OscArg = { type: string, value: unknown }

interface OscMessage {
    address: string
    args: OscArg[]
    host: string
    port: number
    clientId?: string
}

declare function receive(...args: unknown[]): void
declare function send(...args: unknown[]): void
declare function loadJSON(path: string, errorCallback?: (err: unknown) => void): unknown
declare function saveJSON(path: string, data: unknown, errorCallback?: (err: unknown) => void): void
declare function nativeRequire(moduleName: string): unknown

declare const settings: {
    read(name: string): unknown
    appAddresses(): string[]
}

declare const app: import('node:events').EventEmitter
