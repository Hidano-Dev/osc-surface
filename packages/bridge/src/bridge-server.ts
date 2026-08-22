import { lookup } from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'

import type { DownstreamFrame } from '@oscdesk/shared'

import { createSurfaceCore, type BridgeConfig } from './surface-core'
import { startUdpTransport, type UdpTransport } from './udp-transport'
import { startUiHub, type UiHub } from './ui-hub'
import { createDiagnosticsEngine } from './diagnostics-engine'
import { createGuardEventLog } from './guard-event-log'
import type { NdjsonFs } from './ndjson-writer'
import type { NetworkInterfaceInfo } from './subnet-check'

const TEST_NETWORK_INTERFACES_ENV_VAR = 'OSCDESK_TEST_NETWORK_INTERFACES'

export interface BridgeServer {
  readonly wsPort: number
  readonly oscListenPort: number
  close(): Promise<void>
}

export async function startBridgeServer(options: {
  config: BridgeConfig
  logInfo?: (...args: unknown[]) => void
  logWarn?: (...args: unknown[]) => void
  logError?: (...args: unknown[]) => void
}): Promise<BridgeServer> {
  let udp: UdpTransport | undefined
  let hub: UiHub | undefined
  let core: ReturnType<typeof createSurfaceCore> | undefined
  let diagnosticsRef: ReturnType<typeof createDiagnosticsEngine> | null = null
  let guardLogRef: ReturnType<typeof createGuardEventLog> | null = null
  const logWarn = options.logWarn ?? console.warn
  const logError = options.logError ?? console.error
  const oscListenPort = options.config.bridge.oscListenPort
  const wsPort = options.config.bridge.wsPort

  try {
    // 名前解決はトランスポートより先に済ませる。WebSocket 待受開始から core 生成までの
    // 間に await を挟むと、その隙に接続したクライアントの onConnect が core?. で
    // 黙って落ち、hello / link / manifest を受け取れない接続が残るため
    const unityAddresses = await resolveUnityAddresses(options.config.unity.host, logWarn)

    udp = await startUdpTransport({
      host: options.config.bridge.oscListenHost,
      port: oscListenPort,
      onMessage: message => core?.handleOscIn(message),
      onDecodeError: (error, from) => logWarn('(WARN, BRIDGE)', 'OSC decode failed', from, error),
      onSocketError: error => logError('(ERROR, BRIDGE)', 'UDP socket error', error),
    })
    hub = await startUiHub({
      host: options.config.bridge.wsHost,
      port: wsPort,
      onConnect: clientId => core?.onUiConnected(clientId),
      onDisconnect: (clientId) => core?.onUiDisconnected(clientId),
      onFrame: (frame, clientId) => core?.handleUiFrame(frame, clientId),
      onInvalidFrame: (clientId, reason, raw) => logWarn('(WARN, BRIDGE)', 'Invalid UI frame', { clientId, reason, raw }),
    })
    core = createSurfaceCore({
      config: options.config,
      unityAddresses,
      sendFn: (host, port, address, ...args) => udp?.send(host, port, address, args),
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
      logError: options.logError,
      // 診断とガードは同じ NDJSON ディレクトリを共有するため、パージ時に互いの
      // カレントファイルを保護対象として問い合わせ合う(消し合い防止)。
      createDiagnosticsEngine: deps => {
        const engine = createDiagnosticsEngine({
          ...(deps as Parameters<typeof createDiagnosticsEngine>[0]),
          interfacesProvider: createNetworkInterfacesProvider(),
          fs: nodeFs,
          logError,
          extraProtectedFiles: () => guardLogRef === null ? [] : [guardLogRef.getCurrentFileName()],
        })
        diagnosticsRef = engine
        return engine
      },
      createGuardEventLog: deps => {
        const guardLog = createGuardEventLog({
          ndjsonDir: options.config.diagnostics.ndjsonDir,
          fs: nodeFs,
          now: deps.now as () => number,
          logError,
          quota: { limitBytes: options.config.diagnostics.ndjsonMaxTotalBytes },
          extraProtectedFiles: () => diagnosticsRef === null ? [] : [diagnosticsRef.getCurrentFileName()],
        })
        guardLogRef = guardLog
        return guardLog
      },
    })
    core.start()
    return {
      wsPort: hub.port,
      oscListenPort: udp.port,
      async close() {
        core?.stop()
        await Promise.all([hub?.close(), udp?.close()])
      },
    }
  } catch (error) {
    core?.stop()
    await Promise.allSettled([hub?.close(), udp?.close()])
    throw error
  }
}

const nodeFs = fs as unknown as NdjsonFs

/**
 * unity.host がホスト名のとき、UDP 送信元(常に数値アドレス)と突き合わせるために
 * 名前解決しておく。解決失敗は警告して空配列(文字列比較のみに退行)。
 */
async function resolveUnityAddresses(host: string, logWarn: (...args: unknown[]) => void): Promise<readonly string[]> {
  if (net.isIP(host) !== 0) return []
  try {
    const results = await lookup(host, { all: true })
    return results.map(result => result.address)
  } catch (error) {
    logWarn('(WARN, BRIDGE)', `Failed to resolve unity.host "${host}".`, error)
    return []
  }
}

function createNetworkInterfacesProvider(): () => readonly NetworkInterfaceInfo[] {
  const override = readNetworkInterfacesOverride(process.env)

  if (override !== null) return () => override

  return () => Object.values(os.networkInterfaces()).flatMap(entries =>
    (entries ?? []).map(entry => ({
      address: entry.address,
      netmask: entry.netmask,
      family: entry.family === 'IPv4' ? 'IPv4' as const : 'IPv6' as const,
      internal: entry.internal,
    })),
  )
}

function readNetworkInterfacesOverride(env: NodeJS.ProcessEnv): readonly NetworkInterfaceInfo[] | null {
  const raw = env[TEST_NETWORK_INTERFACES_ENV_VAR]
  if (raw === undefined || raw.trim() === '') return null

  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR} must be a JSON array.`)
  }

  return parsed.map((entry, index) => normalizeNetworkInterfaceInfo(entry, index))
}

function normalizeNetworkInterfaceInfo(entry: unknown, index: number): NetworkInterfaceInfo {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}] must be an object.`)
  }

  const candidate = entry as Record<string, unknown>
  if (typeof candidate.address !== 'string' || candidate.address.length === 0) {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].address must be a non-empty string.`)
  }
  if (typeof candidate.netmask !== 'string' || candidate.netmask.length === 0) {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].netmask must be a non-empty string.`)
  }
  if (candidate.family !== 'IPv4' && candidate.family !== 'IPv6') {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].family must be "IPv4" or "IPv6".`)
  }
  if (typeof candidate.internal !== 'boolean') {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].internal must be a boolean.`)
  }

  return {
    address: candidate.address,
    netmask: candidate.netmask,
    family: candidate.family,
    internal: candidate.internal,
  }
}
