import { GuardEventRecordSchema, SURFACE_DIAG } from '@osc-surface/shared'

import { createNdjsonWriter, type NdjsonFs, type NdjsonWriter } from './ndjson-writer'

type ReceiveFn = (address: string, ...args: unknown[]) => void
type LogFn = (message?: unknown, ...rest: unknown[]) => void

export interface GuardEventLog {
  recordRejection(event: {
    expectedProjectId: string
    receivedProjectId: string
    isRepeat: boolean
    peer?: { host: string; port: number }
  }): void
  publishTo(clientId: string): void
  getCurrentFileName(): string
  dispose(): void
}

export function createGuardEventLog(deps: {
  ndjsonDir: string
  fs: NdjsonFs
  now: () => number
  receiveFn: ReceiveFn
  logError: LogFn
}): GuardEventLog {
  const writer: NdjsonWriter = createNdjsonWriter({
    dir: deps.ndjsonDir,
    filePrefix: 'osc-guard',
    now: () => new Date(deps.now()),
    fs: deps.fs,
    logError: deps.logError,
  })

  let count = 0
  let latest: {
    ts: string
    expectedProjectId: string
    receivedProjectId: string
    peer?: { host: string; port: number }
  } | null = null
  let disposed = false

  const publish = (clientId?: string) => {
    const options = clientId === undefined ? undefined : { clientId }
    const text = latest === null ? '-' : formatPanelText(latest, count)

    if (options === undefined) {
      deps.receiveFn(SURFACE_DIAG.GUARD, text)
    } else {
      deps.receiveFn(SURFACE_DIAG.GUARD, text, options)
    }
  }

  return {
    recordRejection(event) {
      if (disposed) {
        return
      }

      count += 1
      const ts = new Date(deps.now()).toISOString()
      latest = {
        ts,
        expectedProjectId: event.expectedProjectId,
        receivedProjectId: event.receivedProjectId,
        peer: event.peer,
      }

      if (!event.isRepeat) {
        const record = GuardEventRecordSchema.parse({
          ts,
          kind: 'guard-reject',
          expectedProjectId: event.expectedProjectId,
          receivedProjectId: event.receivedProjectId,
          peer: event.peer,
        })
        writer.append(record)
        deps.logError(
          '(ERROR, CUSTOM MODULE)',
          `Manifest project mismatch: expected "${event.expectedProjectId}", received "${event.receivedProjectId}".`,
        )
      }

      publish()
    },

    publishTo(clientId) {
      if (disposed) {
        return
      }

      publish(clientId)
    },

    getCurrentFileName() {
      return writer.getCurrentFileName()
    },

    dispose() {
      if (disposed) {
        return
      }

      disposed = true
      writer.dispose()
    },
  }
}

function formatPanelText(event: {
  ts: string
  expectedProjectId: string
  receivedProjectId: string
  peer?: { host: string; port: number }
}, count: number): string {
  const peer = event.peer === undefined ? '' : ` @ ${event.peer.host}:${event.peer.port}`
  return `${event.ts} 拒否 expected="${event.expectedProjectId}" received="${event.receivedProjectId}"${peer} (計${count}回)`
}
