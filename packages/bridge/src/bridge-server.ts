import fs from 'node:fs'
import os from 'node:os'

import type { DownstreamFrame } from '@oscdesk/shared'

import { createSurfaceCore, type BridgeConfig } from './surface-core'
import { startUdpTransport, type UdpTransport } from './udp-transport'
import { startUiHub, type UiHub } from './ui-hub'
import { createDiagnosticsEngine } from './diagnostics-engine'
import { createGuardEventLog } from './guard-event-log'
import type { NdjsonFs } from './ndjson-writer'

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
  const logWarn = options.logWarn ?? console.warn
  const logError = options.logError ?? console.error
  const oscListenPort = options.config.bridge.oscListenPort
  const wsPort = options.config.bridge.wsPort

  try {
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
      sendFn: (host, port, address, ...args) => udp?.send(host, port, address, args),
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
      logError: options.logError,
      createDiagnosticsEngine: deps => createDiagnosticsEngine({
        ...(deps as Parameters<typeof createDiagnosticsEngine>[0]),
        interfacesProvider: networkInterfaces,
        fs: nodeFs,
        logError,
      }),
      createGuardEventLog: deps => createGuardEventLog({
        ndjsonDir: options.config.diagnostics.ndjsonDir,
        fs: nodeFs,
        now: deps.now as () => number,
        logError,
        quota: { limitBytes: options.config.diagnostics.ndjsonMaxTotalBytes },
      }),
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

function networkInterfaces() {
  return Object.values(os.networkInterfaces()).flatMap(entries =>
    (entries ?? []).map(entry => ({
      address: entry.address,
      netmask: entry.netmask,
      family: entry.family === 'IPv4' ? 'IPv4' as const : 'IPv6' as const,
      internal: entry.internal,
    })),
  )
}
