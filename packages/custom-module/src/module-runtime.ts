import { SURFACE, SYS, type OscArg, type SurfaceConfig } from '@osc-surface/shared'

import { loadSurfaceConfig, type JsonLoader } from './config'
import { PingMonitor } from './ping-monitor'

const PING_INTERVAL_MS = 2000

type TimerHandle = ReturnType<typeof setInterval>

type SendFn = (host: string, port: number, address: string, ...args: OscArg[]) => void
type SetIntervalFn = (callback: () => void, intervalMs: number) => TimerHandle
type ClearIntervalFn = (handle: TimerHandle) => void
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

export interface CustomModuleRuntimeDeps {
  clearIntervalFn?: ClearIntervalFn
  loadConfig?: () => SurfaceConfig
  logError?: LogFn
  now?: () => number
  sendFn: SendFn
  setIntervalFn?: SetIntervalFn
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
  const setIntervalFn = deps.setIntervalFn ?? setInterval
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  const now = deps.now ?? Date.now
  const logError = deps.logError ?? console.error
  const monitor = new PingMonitor()

  let config: SurfaceConfig | null = null
  let pingTimer: TimerHandle | null = null

  const clearPingTimer = () => {
    if (pingTimer !== null) {
      clearIntervalFn(pingTimer)
      pingTimer = null
    }
  }

  const sendPing = () => {
    if (config === null) {
      return
    }

    const seq = monitor.nextPing(now())
    deps.sendFn(config.unity.host, config.unity.sendPort, SYS.PING, { type: 'i', value: seq })
  }

  return {
    init() {
      clearPingTimer()

      try {
        config = loadConfig()
      } catch (error) {
        config = null
        logError('(ERROR, CUSTOM MODULE)', error)
        return
      }

      pingTimer = setIntervalFn(sendPing, PING_INTERVAL_MS)
    },

    oscInFilter(data: OscMessage) {
      try {
        if (data.address === SYS.PONG) {
          const seq = readIntArg(data.args[0])

          if (seq !== null) {
            monitor.onPong(seq, now())
          }

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
      return data
    },

    stop() {
      clearPingTimer()
    },

    unload() {
      clearPingTimer()
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
