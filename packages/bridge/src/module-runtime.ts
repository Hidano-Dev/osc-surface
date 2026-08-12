import { SURFACE, SURFACE_DIAG, SYS, type Manifest, type OscArg, type SurfaceConfig } from '@oscdesk/shared'
import type { EventEmitter } from 'node:events'
import fs from 'node:fs'

import { formatConfigLoadError, loadSurfaceConfig, resolveSurfaceConfigPath } from './config'
import { createDiagnosticsEngine, type DiagnosticsEngine } from './diagnostics-engine'
import { createGuardEventLog, type GuardEventLog } from './guard-event-log'
import { createLayoutSnapshotStore, type LayoutSnapshotStore } from './layout-snapshot'
import { buildApplyPlan, type ApplyPlan } from './manifest-apply'
import { ManifestClient } from './manifest-client'
import { OscUiRouter } from './osc-ui-router'
import { PingMonitor } from './ping-monitor'
import type { NetworkInterfaceInfo } from './subnet-check'

const PING_INTERVAL_MS = 2000
const MANIFEST_REQUEST_INTERVAL_MS = 2000
const TEST_NETWORK_INTERFACES_ENV_VAR = 'OSC_SURFACE_TEST_NETWORK_INTERFACES'
const path = loadPathModule()

type TimerHandle = ReturnType<typeof setInterval>

type SendFn = (host: string, port: number, address: string, ...args: OscArg[]) => void
type ReceiveFn = (address: string, ...args: unknown[]) => void
type SettingsReadFn = (name: string) => unknown
type LayoutLoader = () => unknown
type SetIntervalFn = (callback: () => void, intervalMs: number) => TimerHandle
type ClearIntervalFn = (handle: TimerHandle) => void
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void
type AppEvents = Pick<EventEmitter, 'on' | 'off'>
type SessionClient = { id?: unknown } | undefined
type DiagnosticsEngineFactory = typeof createDiagnosticsEngine
type GuardEventLogFactory = typeof createGuardEventLog

export interface CustomModuleRuntimeDeps {
  appEvents?: AppEvents
  clearIntervalFn?: ClearIntervalFn
  createDiagnosticsEngine?: DiagnosticsEngineFactory
  createGuardEventLog?: GuardEventLogFactory
  diagnosticsFs?: ReturnType<typeof loadFsModule>
  loadConfig?: () => SurfaceConfig
  loadLayout?: LayoutLoader
  logError?: LogFn
  logInfo?: LogFn
  logWarn?: LogFn
  networkInterfaces?: ReturnType<typeof loadOsModule>['networkInterfaces']
  now?: () => number
  receiveFn?: ReceiveFn
  sendFn: SendFn
  setIntervalFn?: SetIntervalFn
  settingsRead?: SettingsReadFn
}

export interface CustomModuleRuntime {
  init(): void
  oscInFilter(data: OscMessage): OscMessage | false
  oscOutFilter(data: OscMessage): OscMessage | false
  stop(): void
  unload(): void
}

export function createCustomModuleRuntime(deps: CustomModuleRuntimeDeps): CustomModuleRuntime {
  const loadConfig = deps.loadConfig ?? (() => {
    const result = loadSurfaceConfig({
      path: resolveSurfaceConfigPath(),
      readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
    })

    if (!result.ok) {
      throw new Error(formatConfigLoadError(result.error))
    }

    return result.value
  })
  const settingsRead = deps.settingsRead ?? defaultSettingsRead
  const loadLayout = deps.loadLayout ?? (() => loadCurrentLayoutJson(settingsRead))
  const setIntervalFn = deps.setIntervalFn ?? setInterval
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  const now = deps.now ?? Date.now
  const logError = deps.logError ?? console.error
  const logInfo = deps.logInfo ?? console.log
  const logWarn = deps.logWarn ?? console.warn
  const receiveFn = deps.receiveFn ?? defaultReceive
  const appEvents = deps.appEvents ?? defaultAppEvents()
  const diagnosticsFs = deps.diagnosticsFs ?? loadFsModule()
  const networkInterfaces = deps.networkInterfaces ?? createNetworkInterfacesProvider(loadOsModule().networkInterfaces)
  const buildDiagnosticsEngine = deps.createDiagnosticsEngine ?? createDiagnosticsEngine
  const buildGuardEventLog = deps.createGuardEventLog ?? createGuardEventLog
  const layoutSnapshotStore: LayoutSnapshotStore = createLayoutSnapshotStore({ loadLayout })
  const monitor = new PingMonitor()
  let manifestClient = new ManifestClient({
    requestIntervalMs: MANIFEST_REQUEST_INTERVAL_MS,
  })

  let config: SurfaceConfig | null = null
  let pingTimer: TimerHandle | null = null
  let acceptedPlan: ApplyPlan | null = null
  let acceptedManifest: Manifest | null = null
  let acceptedManifestJson: string | null = null
  let lastForcedManifestRequestAtMs: number | null = null
  let diagnostics: DiagnosticsEngine | null = null
  let guardEventLog: GuardEventLog | null = null
  let uiRouter: OscUiRouter | null = null
  let refreshManifestOnNextAcceptedPong = false
  const warnedSuppressedSurfaceAddresses = new Set<string>()

  const onSessionOpened = (_data: unknown, client: SessionClient) => {
    const clientId = typeof client?.id === 'string' && client.id.length > 0 ? client.id : null

    if (clientId === null) {
      return
    }

    guardEventLog?.publishTo(clientId)

    if (acceptedPlan !== null) {
      let planForSession = acceptedPlan

      if (
        acceptedManifest !== null &&
        acceptedPlan.selfHealEvents.some((event) => event.kind === 'container-injected')
      ) {
        const refreshResult = layoutSnapshotStore.refresh()

        if (refreshResult.ok) {
          const refreshedPlan = buildApplyPlan(acceptedManifest, refreshResult.snapshot)
          acceptedPlan = refreshedPlan
          planForSession = refreshedPlan
        }
      }

      applyPlanToClient(planForSession, clientId)
    }

    // 自作 UI はレイアウト JSON を持たないため、/EDIT ではなくマニフェストそのものを配る。
    publishManifest(clientId)
  }

  const clearPingTimer = () => {
    if (pingTimer !== null) {
      clearIntervalFn(pingTimer)
      pingTimer = null
    }
  }

  const clearDiagnostics = () => {
    if (diagnostics !== null) {
      diagnostics.dispose()
      diagnostics = null
    }
  }

  const clearGuardEventLog = () => {
    if (guardEventLog !== null) {
      guardEventLog.dispose()
      guardEventLog = null
    }
  }

  /**
   * OSC ネイティブ UI からの受信、および Unity から OSC ネイティブ UI へのエコーバックを
   * 中継する。config.oscUi.enabled が false のときは何もしない(従来動作のまま)。
   */
  const routeOscUiMessage = (data: OscMessage) => {
    if (uiRouter === null || config === null) {
      return
    }

    const decision = uiRouter.route({ host: data.host, port: data.port }, now())

    if (decision.kind === 'to-unity') {
      sendMessage(config.unity.host, config.unity.sendPort, data.address, ...data.args)
      return
    }

    if (decision.kind === 'to-ui') {
      for (const target of decision.targets) {
        sendMessage(target.host, target.port, data.address, ...data.args)
      }
    }
  }

  const warnSuppressedSurfaceOutbound = (address: string) => {
    if (warnedSuppressedSurfaceAddresses.has(address)) {
      return
    }

    warnedSuppressedSurfaceAddresses.add(address)
    logWarn('(WARN, CUSTOM MODULE)', `Blocked outbound internal surface message "${address}".`)
  }

  const sendMessage = (host: string, port: number, address: string, ...args: OscArg[]) => {
    diagnostics?.recordOutgoing(address, args, host, port)
    deps.sendFn(host, port, address, ...args)
  }

  const sendPing = () => {
    if (config === null) {
      return
    }

    const consecutiveLossesBefore = monitor.snapshot().consecutiveLosses
    const seq = monitor.nextPing(now())
    diagnostics?.onPingCycle({
      previousLost: monitor.snapshot().consecutiveLosses > consecutiveLossesBefore,
    })
    refreshManifestOnNextAcceptedPong ||= monitor.snapshot().consecutiveLosses >= 1
    sendMessage(config.unity.host, config.unity.sendPort, SYS.PING, { type: 'i', value: seq })
  }

  const onInterval = () => {
    sendPing()
    requestManifestIfNeeded(now())
  }

  const requestManifestIfNeeded = (nowMs: number, options?: { force?: boolean }) => {
    if (config === null) {
      return
    }

    if (!options?.force && !manifestClient.shouldRequest(nowMs)) {
      return
    }

    sendMessage(config.unity.host, config.unity.sendPort, SYS.MANIFEST_REQUEST)
    manifestClient.onRequestSent(nowMs)
  }

  const logWarnings = (warnings: readonly string[]) => {
    for (const warning of warnings) {
      logWarn('(WARN, CUSTOM MODULE)', warning)
    }
  }

  const logSnapshotWarningDiff = (previous: readonly string[], current: readonly string[]) => {
    const previousWarnings = new Set(previous)
    logWarnings(current.filter((warning) => !previousWarnings.has(warning)))
  }

  const applyPlanToClient = (applyPlan: ApplyPlan, clientId?: string) => {
    const deliveryOptions = clientId === undefined ? undefined : { clientId }

    for (const edit of applyPlan.edits) {
      if (deliveryOptions === undefined) {
        receiveFn('/EDIT', edit.widgetId, JSON.stringify(edit.props), JSON.stringify({ noWarning: true }))
      } else {
        receiveFn('/EDIT', edit.widgetId, JSON.stringify(edit.props), JSON.stringify({ noWarning: true }), deliveryOptions)
      }
    }

    for (const valueSync of applyPlan.valueSyncs) {
      if (deliveryOptions === undefined) {
        receiveFn(valueSync.address, valueSync.arg.value)
      } else {
        receiveFn(valueSync.address, valueSync.arg.value, deliveryOptions)
      }
    }
  }

  /**
   * 採用済みマニフェストを WebSocket クライアント(自作 UI)へ配る。
   * O-S-C 内蔵 UI 向けの `/EDIT` とは独立した経路で、レイアウト JSON を持たない
   * 自作 UI でもマニフェストだけで画面を構築できるようにする。
   * clientId 省略時は全クライアントへブロードキャストする。
   */
  const publishManifest = (clientId?: string) => {
    if (acceptedManifestJson === null) {
      return
    }

    if (clientId === undefined) {
      receiveFn(SURFACE.MANIFEST, acceptedManifestJson)
      return
    }

    receiveFn(SURFACE.MANIFEST, acceptedManifestJson, { clientId })
  }

  const applyManifest = (manifestJson: string, peer: { host: string; port: number }) => {
    const result = manifestClient.onManifestPayload(manifestJson)

    if (!result.accepted) {
      if (result.reason === 'project-mismatch') {
        guardEventLog?.recordRejection({
          expectedProjectId: result.expectedProjectId,
          receivedProjectId: result.receivedProjectId,
          isRepeat: result.isRepeat,
          peer,
        })
        return
      }

      if (!result.isRepeat) {
        logError('(ERROR, CUSTOM MODULE)', `Manifest ${result.reason}: ${result.detail}`)
      }
      return
    }

    const previousSnapshot = layoutSnapshotStore.current()
    const refreshResult = layoutSnapshotStore.refresh()
    const snapshot = refreshResult.ok ? refreshResult.snapshot : refreshResult.lastGood

    if (!refreshResult.ok) {
      guardEventLog?.recordSelfHeal({ kind: 'layout-reload-failed', detail: refreshResult.error })
    }

    // 自作 UI はレイアウト JSON に依存しないため、/EDIT 用のスナップショットが
    // 無くてもマニフェストは採用し、WebSocket クライアントへ配る。
    acceptedManifest = result.manifest
    acceptedManifestJson = JSON.stringify(result.manifest)

    if (snapshot === null) {
      publishManifest()

      // レイアウト無しで起動した場合、ここは受信のたびに通る。Unity への
      // 再要求が応答速度そのままの繰り返しにならないよう間隔を守る。
      const nowMs = now()

      if (lastForcedManifestRequestAtMs === null || nowMs - lastForcedManifestRequestAtMs >= MANIFEST_REQUEST_INTERVAL_MS) {
        lastForcedManifestRequestAtMs = nowMs
        requestManifestIfNeeded(nowMs, { force: true })
      }

      return
    }

    const applyPlan = buildApplyPlan(result.manifest, snapshot)
    acceptedPlan = applyPlan
    logSnapshotWarningDiff(previousSnapshot?.warnings ?? [], snapshot.warnings)
    logWarnings(applyPlan.warnings.filter((warning) => !snapshot.warnings.includes(warning)))
    for (const event of applyPlan.selfHealEvents) {
      guardEventLog?.recordSelfHeal(
        event.kind === 'container-injected'
          ? { kind: event.kind, detail: 'dynamic container injected' }
          : {
              kind: event.kind,
              detail: `${event.address}: "${event.requestedId}" -> "${event.assignedId}"`,
            },
      )
    }
    applyPlanToClient(applyPlan)
    publishManifest()
  }

  return {
    init() {
      clearPingTimer()
      clearDiagnostics()
      clearGuardEventLog()
      acceptedPlan = null
      acceptedManifest = null
      acceptedManifestJson = null
      lastForcedManifestRequestAtMs = null
      uiRouter = null
      refreshManifestOnNextAcceptedPong = false

      try {
        config = loadConfig()
      } catch (error) {
        config = null
        logError('(ERROR, CUSTOM MODULE)', error)
        return
      }

      const refreshResult = layoutSnapshotStore.refresh()
      if (refreshResult.ok) {
        logWarnings(refreshResult.snapshot.warnings)
      } else {
        logError('(ERROR, CUSTOM MODULE)', `Unable to load initial layout snapshot: ${refreshResult.error}`)
      }

      manifestClient = new ManifestClient({
        requestIntervalMs: MANIFEST_REQUEST_INTERVAL_MS,
        expectedProjectId: config.expectedProjectId,
      })

      guardEventLog = buildGuardEventLog({
        ndjsonDir: config.diagnostics.ndjsonDir,
        fs: diagnosticsFs,
        now,
        receiveFn,
        logError,
        // With debug enabled the diagnostics engine owns purging (its current
        // file is not visible to the guard log, so auto-purge must stay off).
        quota: config.debug ? undefined : { limitBytes: config.diagnostics.ndjsonMaxTotalBytes },
      })

      if (config.debug) {
        diagnostics = buildDiagnosticsEngine({
          config,
          getStatus: () => monitor.snapshot(),
          receiveFn,
          interfacesProvider: () => networkInterfaces(),
          fs: diagnosticsFs,
          protectedFileNames: [guardEventLog.getCurrentFileName()],
          now,
          setIntervalFn,
          clearIntervalFn,
          logError,
        })
        logInfo('(INFO, CUSTOM MODULE)', 'Diagnostics debug mode enabled.')
      } else {
        logInfo('(INFO, CUSTOM MODULE)', 'Diagnostics debug mode disabled.')
      }

      if (config.oscUi.enabled) {
        uiRouter = new OscUiRouter({
          unity: { host: config.unity.host, port: config.unity.sendPort },
          config: config.oscUi,
        })
        logInfo(
          '(INFO, CUSTOM MODULE)',
          `OSC-native UI routing enabled (announce on ${SURFACE.HELLO}, ${String(config.oscUi.staticPeers.length)} static peer(s)).`,
        )
      } else {
        uiRouter = null
      }

      appEvents.off('sessionOpened', onSessionOpened)
      appEvents.on('sessionOpened', onSessionOpened)

      requestManifestIfNeeded(now())
      pingTimer = setIntervalFn(onInterval, PING_INTERVAL_MS)
    },

    oscInFilter(data: OscMessage) {
      try {
        diagnostics?.recordIncoming(data.address, data.args, data.host, data.port)

        if (data.address === SYS.PONG) {
          const seq = readIntArg(data.args[0])

          if (seq !== null) {
            const result = monitor.onPong(seq, now())
            const shouldRefreshManifest = result.accepted && (result.recoveredFromLoss || refreshManifestOnNextAcceptedPong)

            if (shouldRefreshManifest) {
              refreshManifestOnNextAcceptedPong = false
              manifestClient.onReachabilityRecovered()
              requestManifestIfNeeded(now(), { force: true })
            }

            if (result.accepted) {
              diagnostics?.onPongAccepted()
            }
          }

          return false
        }

        if (data.address === SYS.MANIFEST) {
          const manifestJson = readStringArg(data.args[0])

          if (manifestJson === null) {
            logError('(ERROR, CUSTOM MODULE)', 'Manifest payload must be a string.')
            return false
          }

          applyManifest(manifestJson, { host: data.host, port: data.port })
          return false
        }

        if (data.address === SURFACE.STATUS_REQUEST) {
          deps.sendFn(data.host, data.port, SURFACE.STATUS, {
            type: 's',
            value: JSON.stringify(monitor.snapshot()),
          })

          return false
        }

        if (data.address === SURFACE.HELLO) {
          if (uiRouter !== null) {
            const announcedPort = readIntArg(data.args[0]) ?? data.port
            const result = uiRouter.registerPeer(data.host, announcedPort, now())

            if (result.added) {
              logInfo(
                '(INFO, CUSTOM MODULE)',
                `OSC UI peer registered: ${result.peer.host}:${String(result.peer.port)}`,
              )
            }
          } else {
            logWarn('(WARN, CUSTOM MODULE)', 'Received /surface/hello but oscUi is disabled in the config.')
          }

          return false
        }

        if (data.address === SURFACE_DIAG.REQUEST) {
          if (diagnostics !== null) {
            deps.sendFn(data.host, data.port, SURFACE_DIAG.SNAPSHOT, {
              type: 's',
              value: JSON.stringify(diagnostics.snapshot()),
            })
          }

          return false
        }

        if (isInternalAddress(data.address)) {
          return false
        }

        routeOscUiMessage(data)

        return data
      } catch (error) {
        logError('(ERROR, CUSTOM MODULE)', error)
        return data
      }
    },

    oscOutFilter(data: OscMessage) {
      if (data.address === SURFACE_DIAG.PURGE) {
        warnSuppressedSurfaceOutbound(data.address)
        diagnostics?.purgeLogs()
        return false
      }

      // 自作 UI からのマニフェスト再配信要求。UDP には出さず、要求元(判別できなければ
      // 全クライアント)へ採用済みマニフェストを配り直す。
      if (data.address === SURFACE.MANIFEST_REQUEST) {
        publishManifest(typeof data.clientId === 'string' && data.clientId.length > 0 ? data.clientId : undefined)
        return false
      }

      if (data.address.startsWith('/surface/')) {
        warnSuppressedSurfaceOutbound(data.address)
        return false
      }

      diagnostics?.recordOutgoing(data.address, data.args, data.host, data.port)
      return data
    },

    stop() {
      clearPingTimer()
      clearDiagnostics()
      clearGuardEventLog()
      uiRouter = null
      appEvents.off('sessionOpened', onSessionOpened)
    },

    unload() {
      clearPingTimer()
      clearDiagnostics()
      clearGuardEventLog()
      uiRouter = null
      appEvents.off('sessionOpened', onSessionOpened)
    },
  }
}

function isInternalAddress(address: string): boolean {
  return address.startsWith('/sys/') || address.startsWith('/surface/')
}

function readIntArg(arg: { type: string; value: unknown } | undefined): number | null {
  if (arg?.type !== 'i' || !Number.isInteger(arg.value)) {
    return null
  }

  return arg.value as number
}

function readStringArg(arg: { type: string; value: unknown } | undefined): string | null {
  if (arg?.type !== 's' || typeof arg.value !== 'string') {
    return null
  }

  return arg.value
}

function loadCurrentLayoutJson(settingsRead: SettingsReadFn): unknown {
  const layoutPath = settingsRead('load')

  if (typeof layoutPath !== 'string' || layoutPath.trim() === '') {
    throw new Error('Unable to resolve the current O-S-C session path from settings.read("load").')
  }

  return loadJSON(resolveLayoutPath(layoutPath.trim()))
}

function resolveLayoutPath(layoutPath: string): string {
  if (path.isAbsolute(layoutPath)) {
    return layoutPath
  }

  return path.resolve(process.cwd(), layoutPath)
}

function defaultSettingsRead(name: string): unknown {
  return settings.read(name)
}

function defaultReceive(address: string, ...args: unknown[]): void {
  receive(address, ...args)
}

function defaultAppEvents(): AppEvents {
  if (typeof app === 'undefined') {
    return {
      on() {
        return this
      },
      off() {
        return this
      },
    }
  }

  return app
}

function loadPathModule(): typeof import('node:path') {
  if (typeof nativeRequire === 'function') {
    return nativeRequire('node:path') as typeof import('node:path')
  }

  return require('node:path') as typeof import('node:path')
}

function loadFsModule(): typeof import('node:fs') {
  if (typeof nativeRequire === 'function') {
    return nativeRequire('node:fs') as typeof import('node:fs')
  }

  return require('node:fs') as typeof import('node:fs')
}

function loadOsModule(): typeof import('node:os') {
  if (typeof nativeRequire === 'function') {
    return nativeRequire('node:os') as typeof import('node:os')
  }

  return require('node:os') as typeof import('node:os')
}

function createNetworkInterfacesProvider(
  defaultProvider: ReturnType<typeof loadOsModule>['networkInterfaces'],
): () => readonly NetworkInterfaceInfo[] {
  const override = readNetworkInterfacesOverride(process.env)

  if (override !== null) {
    return () => override
  }

  return () => flattenNetworkInterfaces(defaultProvider())
}

function readNetworkInterfacesOverride(env: NodeJS.ProcessEnv): readonly NetworkInterfaceInfo[] | null {
  const raw = env[TEST_NETWORK_INTERFACES_ENV_VAR]

  if (raw === undefined || raw.trim() === '') {
    return null
  }

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

function flattenNetworkInterfaces(
  interfaces: ReturnType<ReturnType<typeof loadOsModule>['networkInterfaces']>,
): readonly NetworkInterfaceInfo[] {
  return Object.values(interfaces).flatMap((entries) =>
    (entries ?? []).map((entry) => ({
      address: entry.address,
      netmask: entry.netmask,
      family: entry.family === 'IPv6' ? 'IPv6' : 'IPv4',
      internal: entry.internal,
    })),
  )
}
