import {
  isInternalAddress,
  isOscdeskAddress,
  OSCDESK,
  OSCDESK_DIAG,
  SYS,
  type DownstreamFrame,
  type LinkManifestStatus,
  type LinkRejection,
  type LinkUnityStatus,
  type Manifest,
  type OscArg,
  type BridgeConfig as RuntimeBridgeConfig,
  type UpstreamFrame,
} from '@oscdesk/shared'

import { ManifestClient } from './manifest-client'
import { PingMonitor } from './ping-monitor'
import { OscUiRouter } from './osc-ui-router'

const PING_INTERVAL_MS = 2_000

type TimerHandle = ReturnType<typeof setInterval> | number
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void
type SendFn = (host: string, port: number, address: string, ...args: OscArg[]) => void

export type ClientId = string

export interface InboundOscMessage {
  address: string
  args: readonly OscArg[]
  from: { host: string; port: number }
}

export type BridgeConfig = RuntimeBridgeConfig & {
  server?: { name?: string; version?: string }
}

export interface SurfaceCoreDeps {
  config: BridgeConfig
  sendFn: SendFn
  publish: (frame: DownstreamFrame, target?: ClientId) => void
  now?: () => number
  setIntervalFn?: (cb: () => void, ms: number) => TimerHandle
  clearIntervalFn?: (handle: TimerHandle) => void
  logInfo?: LogFn
  logWarn?: LogFn
  logError?: LogFn
  createDiagnosticsEngine?: (deps: Record<string, unknown>) => DiagnosticsHooks
  createGuardEventLog?: (deps: Record<string, unknown>) => GuardHooks
}

interface DiagnosticsHooks {
  recordIncoming?: (address: string, args: readonly OscArg[], host: string, port: number) => void
  recordOutgoing?: (address: string, args: readonly OscArg[], host: string, port: number) => void
  onPingCycle?: (event: { previousLost: boolean }) => void
  onPongAccepted?: () => void
  snapshot?: () => unknown
  dispose: () => void
}

interface GuardHooks {
  recordRejection: (event: {
    expectedProjectId: string
    receivedProjectId: string
    isRepeat: boolean
    peer?: { host: string; port: number }
  }) => void
  dispose: () => void
}

export interface SurfaceCore {
  start(): void
  stop(): void
  handleOscIn(message: InboundOscMessage): void
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): void
  onUiConnected(clientId: ClientId): void
  onUiDisconnected(clientId: ClientId): void
  linkSnapshot(): { unity: LinkUnityStatus; manifest: LinkManifestStatus; lastRejection: LinkRejection | null }
  helloFrame(clientId: ClientId): DownstreamFrame
}

export function createSurfaceCore(deps: SurfaceCoreDeps): SurfaceCore {
  const now = deps.now ?? Date.now
  const setIntervalFn = deps.setIntervalFn ?? setInterval
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  const logWarn = deps.logWarn ?? console.warn
  const logError = deps.logError ?? console.error
  const monitor = new PingMonitor()
  const uiRouter = deps.config.oscUi.enabled
    ? new OscUiRouter({
        unity: { host: deps.config.unity.host, port: deps.config.unity.sendPort },
        config: deps.config.oscUi,
      })
    : null
  const manifests = new ManifestClient({ expectedProjectId: deps.config.expectedProjectId })
  let timer: TimerHandle | null = null
  let stopped = false
  let refreshAfterRecovery = false
  let acceptedManifest: Manifest | null = null
  let lastRejection: LinkRejection | null = null
  let lastLinkPublishedAt = -Infinity
  const warnedInternalAddresses = new Set<string>()
  let diagnostics: DiagnosticsHooks | null = null
  let guardLog: GuardHooks | null = null

  const publishLink = (target?: ClientId, force = false) => {
    const timestamp = now()
    if (!force && timestamp - lastLinkPublishedAt < PING_INTERVAL_MS) return
    lastLinkPublishedAt = timestamp
    deps.publish({ v: 1, type: 'link', ...linkSnapshot() }, target)
  }

  const sendMessage: SendFn = (host, port, address, ...args) => {
    if (isBridgeInternalAddress(address)) {
      if (!warnedInternalAddresses.has(address)) {
        warnedInternalAddresses.add(address)
        logWarn('(WARN, BRIDGE)', `Blocked outbound internal message "${address}".`)
      }
      return
    }
    diagnostics?.recordOutgoing?.(address, args, host, port)
    deps.sendFn(host, port, address, ...args)
  }

  const requestManifest = () => {
    if (manifests.shouldRequest(now())) {
      sendMessage(deps.config.unity.host, deps.config.unity.sendPort, SYS.MANIFEST_REQUEST)
      manifests.onRequestSent(now())
    }
  }

  const tick = () => {
    if (stopped) return
    const before = monitor.snapshot().consecutiveLosses
    const seq = monitor.nextPing(now())
    refreshAfterRecovery ||= monitor.snapshot().consecutiveLosses > before
    diagnostics?.onPingCycle?.({ previousLost: monitor.snapshot().consecutiveLosses > before })
    sendMessage(deps.config.unity.host, deps.config.unity.sendPort, SYS.PING, { type: 'i', value: seq })
    requestManifest()
    publishLink()
  }

  const handleManifest = (message: InboundOscMessage, payload: string) => {
    const result = manifests.onManifestPayload(payload)
    if (result.accepted !== true) {
      const rejected = result as Extract<typeof result, { accepted: false }>
      if (!rejected.isRepeat) logError('(ERROR, BRIDGE)', `Manifest ${rejected.reason}: ${rejected.detail}`)
      lastRejection = {
        ts: new Date(now()).toISOString(),
        reason: rejected.reason,
        detail: rejected.detail,
        receivedProjectId: rejected.reason === 'project-mismatch' ? rejected.receivedProjectId : null,
      }
      if (rejected.reason === 'project-mismatch') {
        guardLog?.recordRejection({
          expectedProjectId: rejected.expectedProjectId,
          receivedProjectId: rejected.receivedProjectId,
          isRepeat: rejected.isRepeat,
          peer: message.from,
        })
      }
      publishLink(undefined, true)
      return
    }
    acceptedManifest = result.manifest as Manifest
    lastRejection = null
    deps.publish({ v: 1, type: 'manifest', manifest: result.manifest })
    publishLink(undefined, true)
  }

  const linkSnapshot = () => ({
    unity: unityStatus(),
    manifest: acceptedManifest === null
      ? ({ state: 'none' } as const)
      : ({ state: 'accepted', projectId: acceptedManifest.projectId, entryCount: acceptedManifest.entries?.length ?? 0 } as const),
    lastRejection,
  })

  function unityStatus(): LinkUnityStatus {
    const status = monitor.snapshot()
    return {
      reachability: status.consecutiveLosses > 0 ? 'lost' : status.lastPongSeq === null ? 'unknown' : 'reachable',
      lastRttMs: status.lastRttMs,
      consecutiveLosses: status.consecutiveLosses,
      lastPongSeq: status.lastPongSeq,
    }
  }

  return {
    start() {
      if (timer !== null) return
      diagnostics = deps.config.debug
        ? deps.createDiagnosticsEngine?.({ config: deps.config, getStatus: () => unityStatus(), now }) ?? null
        : null
      guardLog = deps.createGuardEventLog?.({ config: deps.config, now }) ?? null
      stopped = false
      requestManifest()
      timer = setIntervalFn(tick, PING_INTERVAL_MS)
    },
    stop() {
      if (timer === null) {
        stopped = true
        return
      }
      clearIntervalFn(timer)
      timer = null
      diagnostics?.dispose()
      guardLog?.dispose()
      diagnostics = null
      guardLog = null
      stopped = true
    },
    handleOscIn(message) {
      if (stopped) return
      diagnostics?.recordIncoming?.(message.address, message.args, message.from.host, message.from.port)
      if (message.address === OSCDESK.HELLO) {
        const port = message.args[0]
        if (uiRouter !== null && port?.type === 'i') {
          uiRouter.registerPeer(message.from.host, port.value, now())
        }
        return
      }
      if (message.address === SYS.PONG) {
        const arg = message.args[0]
        if (arg?.type === 'i' && Number.isInteger(arg.value)) {
          const result = monitor.onPong(arg.value, now())
          if (result.accepted && (result.recoveredFromLoss || refreshAfterRecovery)) {
            refreshAfterRecovery = false
            manifests.onReachabilityRecovered()
            requestManifest()
          }
          if (result.accepted) publishLink()
          if (result.accepted) diagnostics?.onPongAccepted?.()
        }
        return
      }
      if (message.address === SYS.MANIFEST) {
        const arg = message.args[0]
        if (arg?.type !== 's') {
          logError('(ERROR, BRIDGE)', 'Manifest payload must be a string.')
          return
        }
        handleManifest(message, arg.value)
        return
      }
      if (message.address === OSCDESK_DIAG.REQUEST) {
        const snapshot = diagnostics?.snapshot?.()
        if (snapshot !== undefined) {
          deps.sendFn(message.from.host, message.from.port, OSCDESK_DIAG.SNAPSHOT, {
            type: 's', value: JSON.stringify(snapshot),
          })
        }
        return
      }
      if (isInternalAddress(message.address)) return
      // OSC ネイティブ UI の中継(D-7)は WebSocket UI への配信と併存する。
      // 中継の可否で publish を止めないこと(止めると WebSocket UI から外部 OSC が見えなくなる)。
      if (uiRouter !== null) {
        const decision = uiRouter.route(message.from, now())
        if (decision.kind === 'to-unity') {
          sendMessage(deps.config.unity.host, deps.config.unity.sendPort, message.address, ...message.args)
        } else if (decision.kind === 'to-ui') {
          for (const target of decision.targets) {
            deps.sendFn(target.host, target.port, message.address, ...message.args)
          }
        }
      }
      deps.publish({ v: 1, type: 'osc', address: message.address, args: toWireArgs(message.args), from: message.from })
    },
    handleUiFrame(frame, clientId) {
      if (frame.type === 'manifestRequest') {
        if (acceptedManifest !== null) deps.publish({ v: 1, type: 'manifest', manifest: acceptedManifest }, clientId)
        return
      }
      if (frame.type === 'heartbeatAck') return
      sendMessage(deps.config.unity.host, deps.config.unity.sendPort, frame.address, ...toOscArgs(frame.args))
    },
    onUiConnected(clientId) {
      deps.publish(buildHelloFrame(clientId), clientId)
      publishLink(clientId, true)
      if (acceptedManifest !== null) deps.publish({ v: 1, type: 'manifest', manifest: acceptedManifest }, clientId)
    },
    onUiDisconnected(_clientId) {},
    linkSnapshot,
    helloFrame: buildHelloFrame,
  }

  function buildHelloFrame(clientId: ClientId): DownstreamFrame {
      return {
        v: 1, type: 'hello', clientId, protocolVersion: 1,
        server: { name: deps.config.server?.name ?? 'oscdesk-bridge', version: deps.config.server?.version ?? '0.1.0' },
        unity: { host: deps.config.unity.host, sendPort: deps.config.unity.sendPort },
        bridge: {
          oscListenPort: deps.config.bridge.oscListenPort,
          wsPort: deps.config.bridge.wsPort,
        },
        expectedProjectId: deps.config.expectedProjectId ?? null,
        heartbeat: { intervalMs: 15_000, timeoutMs: 30_000 },
        pingIntervalMs: PING_INTERVAL_MS,
        debug: deps.config.debug,
      }
  }
}

function toWireArgs(args: readonly OscArg[]) {
  return args.map((arg) => arg.type === 'b'
    ? { type: 'b' as const, value: Buffer.from(arg.value).toString('base64') }
    : arg)
}

function toOscArgs(args: readonly { type?: 'i' | 'f' | 's' | 'b'; value?: unknown }[]): OscArg[] {
  return args.map((arg) => {
    if (arg.type === 'i' || arg.type === 'f') return { type: arg.type, value: Number(arg.value) } as OscArg
    if (arg.type === 's') return { type: 's', value: String(arg.value) }
    return { type: 'b', value: Buffer.from(String(arg.value ?? ''), 'base64') }
  })
}

function isBridgeInternalAddress(address: string): boolean {
  return isOscdeskAddress(address)
}
