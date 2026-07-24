import {
  DiagnosticsSnapshotSchema,
  type DiagnosticsSnapshot,
  type MessageRecord,
  type RecordedArg,
  type SurfaceConfig,
  type SurfaceStatus,
  type SubnetVerdict,
} from '@osc-surface/shared'

import { createDiagPanelSink, type DiagPanelSink } from './diag-panel-sink'
import { createNdjsonWriter, type NdjsonFs, type NdjsonWriter } from './ndjson-writer'
import { LossRateWindow, deriveReachability } from './link-health'
import { RingBuffer } from './ring-buffer'
import { evaluateSubnetVerdict, type OsInterfacesProvider } from './subnet-check'

type TimerHandle = ReturnType<typeof setInterval>
type ReceiveFn = (address: string, ...args: unknown[]) => void
type SetIntervalFn = (callback: () => void, intervalMs: number) => TimerHandle
type ClearIntervalFn = (handle: TimerHandle) => void
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void
type OscLikeArg = { type: string; value: unknown }

const MAX_RECORDED_STRING_LENGTH = 256
const EMPTY_STATUS: SurfaceStatus = {
  lastRttMs: null,
  consecutiveLosses: 0,
  lastPongSeq: null,
}
const FALLBACK_SUBNET: SubnetVerdict = {
  kind: 'indeterminate',
  reason: 'noIpv4Interface',
}

export interface DiagnosticsEngine {
  recordIncoming(address: string, args: readonly OscLikeArg[], host: string, port: number): void
  recordOutgoing(address: string, args: readonly OscLikeArg[], host: string, port: number): void
  onPingCycle(event: { previousLost: boolean }): void
  onPongAccepted(): void
  snapshot(): DiagnosticsSnapshot
  purgeLogs(): void
  dispose(): void
}

export function createDiagnosticsEngine(deps: {
  config: SurfaceConfig
  getStatus: () => SurfaceStatus
  receiveFn: ReceiveFn
  interfacesProvider: OsInterfacesProvider
  fs: NdjsonFs
  now: () => number
  setIntervalFn?: SetIntervalFn
  clearIntervalFn?: ClearIntervalFn
  logError?: LogFn
}): DiagnosticsEngine {
  const logError = deps.logError ?? console.error
  const recentMessages = new RingBuffer<MessageRecord>(deps.config.diagnostics.ringBufferSize)
  const lossRateWindow = new LossRateWindow(deps.config.diagnostics.lossRateWindow)
  const subnet = evaluateInitialSubnetVerdict(deps.config.unity.host, deps.interfacesProvider, logError)
  const writer = createNdjsonWriter({
    dir: deps.config.diagnostics.ndjsonDir,
    now: () => new Date(deps.now()),
    fs: deps.fs,
    logError,
  })

  const sink = createDiagPanelSink({
    getSnapshot: () => buildSnapshot(),
    receiveFn: deps.receiveFn,
    setIntervalFn: deps.setIntervalFn,
    clearIntervalFn: deps.clearIntervalFn,
  })

  const record = (dir: MessageRecord['dir'], address: string, args: readonly OscLikeArg[], host: string, port: number) => {
    if (address.startsWith('/surface/')) {
      return
    }

    const message: MessageRecord = {
      ts: new Date(deps.now()).toISOString(),
      dir,
      address,
      args: args.map(toRecordedArg),
      peer: {
        host,
        port,
      },
    }

    recentMessages.push(message)
    writer.append(message)
    sink.markDirty()
  }

  const buildSnapshot = (): DiagnosticsSnapshot => {
    const status = readStatus(deps.getStatus, logError)

    return DiagnosticsSnapshotSchema.parse({
      reachability: deriveReachability(status),
      lastRttMs: status.lastRttMs,
      consecutiveLosses: status.consecutiveLosses,
      lossRate: lossRateWindow.stats(),
      subnet,
      logUsage: {
        totalBytes: 0,
        limitBytes: deps.config.diagnostics.ndjsonMaxTotalBytes,
        overLimit: false,
      },
      recentMessages: recentMessages.toArray(),
    })
  }

  return {
    recordIncoming(address, args, host, port) {
      swallow(logError, () => {
        record('in', address, args, host, port)
      })
    },

    recordOutgoing(address, args, host, port) {
      swallow(logError, () => {
        record('out', address, args, host, port)
      })
    },

    onPingCycle(event) {
      swallow(logError, () => {
        if (!event.previousLost) {
          return
        }

        lossRateWindow.record('lost')
        sink.markDirty()
      })
    },

    onPongAccepted() {
      swallow(logError, () => {
        lossRateWindow.record('answered')
        sink.markDirty()
      })
    },

    snapshot() {
      try {
        return buildSnapshot()
      } catch (error) {
        logError('(ERROR, CUSTOM MODULE)', 'Failed to build diagnostics snapshot.', error)

        return DiagnosticsSnapshotSchema.parse({
          reachability: 'unknown',
          lastRttMs: null,
          consecutiveLosses: 0,
          lossRate: lossRateWindow.stats(),
          subnet,
          logUsage: {
            totalBytes: 0,
            limitBytes: deps.config.diagnostics.ndjsonMaxTotalBytes,
            overLimit: false,
          },
          recentMessages: recentMessages.toArray(),
        })
      }
    },

    purgeLogs() {
      swallow(logError, () => {
        // Task 4.2 implements quota-based purge behavior.
      })
    },

    dispose() {
      swallow(logError, () => {
        sink.dispose()
        writer.dispose()
      })
    },
  }
}

function evaluateInitialSubnetVerdict(
  destinationHost: string,
  interfacesProvider: OsInterfacesProvider,
  logError: LogFn,
): SubnetVerdict {
  try {
    return evaluateSubnetVerdict(destinationHost, interfacesProvider())
  } catch (error) {
    logError('(ERROR, CUSTOM MODULE)', 'Failed to evaluate subnet verdict.', error)
    return FALLBACK_SUBNET
  }
}

function readStatus(getStatus: () => SurfaceStatus, logError: LogFn): SurfaceStatus {
  try {
    return getStatus()
  } catch (error) {
    logError('(ERROR, CUSTOM MODULE)', 'Failed to read ping monitor status.', error)
    return EMPTY_STATUS
  }
}

function toRecordedArg(arg: OscLikeArg): RecordedArg {
  if (arg.type === 'b') {
    return {
      kind: 'blob',
      byteLength: readBlobLength(arg.value),
    }
  }

  if (typeof arg.value === 'string') {
    return truncateRecordedString(arg.type, arg.value)
  }

  if (typeof arg.value === 'number' || typeof arg.value === 'boolean') {
    return {
      kind: 'value',
      type: arg.type,
      value: arg.value,
    }
  }

  return {
    kind: 'value',
    type: arg.type,
    value: JSON.stringify(arg.value),
  }
}

function truncateRecordedString(type: string, value: string): RecordedArg {
  if (value.length <= MAX_RECORDED_STRING_LENGTH) {
    return {
      kind: 'value',
      type,
      value,
    }
  }

  return {
    kind: 'value',
    type,
    value: value.slice(0, MAX_RECORDED_STRING_LENGTH),
    truncated: true,
  }
}

function readBlobLength(value: unknown): number {
  if (value instanceof Uint8Array) {
    return value.byteLength
  }

  if (typeof value === 'object' && value !== null && 'byteLength' in value) {
    const byteLength = (value as { byteLength: unknown }).byteLength
    if (typeof byteLength === 'number' && Number.isInteger(byteLength) && byteLength >= 0) {
      return byteLength
    }
  }

  return 0
}

function swallow(logError: LogFn, action: () => void): void {
  try {
    action()
  } catch (error) {
    logError('(ERROR, CUSTOM MODULE)', error)
  }
}
