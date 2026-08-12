import type { DownstreamFrame } from '@oscdesk/shared'

import { createSurfaceCore, type BridgeConfig } from './surface-core'
import { startUdpTransport, type UdpTransport } from './udp-transport'
import { startUiHub, type UiHub } from './ui-hub'

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
  const oscListenPort = options.config.bridge?.oscListenPort ?? options.config.unity.receivePort
  const wsPort = options.config.bridge?.wsPort ?? 7080

  try {
    udp = await startUdpTransport({
      port: oscListenPort,
      onMessage: message => core?.handleOscIn(message),
      onDecodeError: (error, from) => logWarn('(WARN, BRIDGE)', 'OSC decode failed', from, error),
      onSocketError: error => logError('(ERROR, BRIDGE)', 'UDP socket error', error),
    })
    hub = await startUiHub({
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
