import { SURFACE, SYS, type OscArg, type SurfaceConfig } from '@osc-surface/shared'
import type { EventEmitter } from 'node:events'

import { loadSurfaceConfig, type JsonLoader } from './config'
import { createDiagnosticsEngine, type DiagnosticsEngine } from './diagnostics-engine'
import { buildLayoutIndex, type LayoutIndex } from './layout-index'
import { buildApplyPlan, DYNAMIC_CONTAINER_ID, type ApplyPlan } from './manifest-apply'
import { ManifestClient } from './manifest-client'
import { PingMonitor } from './ping-monitor'

const PING_INTERVAL_MS = 2000
const MANIFEST_REQUEST_INTERVAL_MS = 2000
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

export interface CustomModuleRuntimeDeps {
  appEvents?: AppEvents
  clearIntervalFn?: ClearIntervalFn
  createDiagnosticsEngine?: DiagnosticsEngineFactory
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
  oscOutFilter(data: OscMessage): OscMessage
  stop(): void
  unload(): void
}

export function createCustomModuleRuntime(deps: CustomModuleRuntimeDeps): CustomModuleRuntime {
  const loadConfig = deps.loadConfig ?? (() => loadSurfaceConfig(loadJSON as JsonLoader))
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
  const networkInterfaces = deps.networkInterfaces ?? loadOsModule().networkInterfaces
  const buildDiagnosticsEngine = deps.createDiagnosticsEngine ?? createDiagnosticsEngine
  const monitor = new PingMonitor()
  const manifestClient = new ManifestClient({
    requestIntervalMs: MANIFEST_REQUEST_INTERVAL_MS,
  })

  let config: SurfaceConfig | null = null
  let layout: LayoutIndex | null = null
  let pingTimer: TimerHandle | null = null
  let acceptedPlan: ApplyPlan | null = null
  let diagnostics: DiagnosticsEngine | null = null
  let refreshManifestOnNextAcceptedPong = false

  const onSessionOpened = (_data: unknown, client: SessionClient) => {
    const clientId = typeof client?.id === 'string' && client.id.length > 0 ? client.id : null

    if (clientId === null || acceptedPlan === null) {
      return
    }

    applyPlanToClient(acceptedPlan, clientId)
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

  const applyManifest = (manifestJson: string) => {
    const result = manifestClient.onManifestPayload(manifestJson)

    if (!result.accepted) {
      if (!result.isRepeat) {
        logError('(ERROR, CUSTOM MODULE)', `Manifest ${result.reason}: ${result.detail}`)
      }
      return
    }

    if (layout === null) {
      logError('(ERROR, CUSTOM MODULE)', 'Manifest received before layout index was initialized.')
      return
    }

    const applyPlan = buildApplyPlan(result.manifest, layout)
    acceptedPlan = applyPlan
    logWarnings(applyPlan.warnings)
    applyPlanToClient(applyPlan)
  }

  return {
    init() {
      clearPingTimer()
      clearDiagnostics()
      acceptedPlan = null
      refreshManifestOnNextAcceptedPong = false

      try {
        config = loadConfig()
        layout = buildLayoutIndex(loadLayout(), {
          excludeContainerIds: [DYNAMIC_CONTAINER_ID],
        })
      } catch (error) {
        config = null
        layout = null
        logError('(ERROR, CUSTOM MODULE)', error)
        return
      }

      if (layout !== null) {
        logWarnings(layout.warnings)
      }

      if (config.debug) {
        diagnostics = buildDiagnosticsEngine({
          config,
          getStatus: () => monitor.snapshot(),
          receiveFn,
          interfacesProvider: () => networkInterfaces(),
          fs: diagnosticsFs,
          now,
          setIntervalFn,
          clearIntervalFn,
          logError,
        })
        logInfo('(INFO, CUSTOM MODULE)', 'Diagnostics debug mode enabled.')
      } else {
        logInfo('(INFO, CUSTOM MODULE)', 'Diagnostics debug mode disabled.')
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

          applyManifest(manifestJson)
          return false
        }

        if (data.address === SURFACE.STATUS_REQUEST) {
          deps.sendFn(data.host, data.port, SURFACE.STATUS, {
            type: 's',
            value: JSON.stringify(monitor.snapshot()),
          })

          return false
        }

        if (isInternalAddress(data.address)) {
          return false
        }

        return data
      } catch (error) {
        logError('(ERROR, CUSTOM MODULE)', error)
        return data
      }
    },

    oscOutFilter(data: OscMessage) {
      diagnostics?.recordOutgoing(data.address, data.args, data.host, data.port)
      return data
    },

    stop() {
      clearPingTimer()
      clearDiagnostics()
      appEvents.off('sessionOpened', onSessionOpened)
    },

    unload() {
      clearPingTimer()
      clearDiagnostics()
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
