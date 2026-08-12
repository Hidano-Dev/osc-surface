import path from 'node:path'

import { GuardEventRecordSchema } from '@oscdesk/shared'

import { calculateLogUsage, listNdjsonFiles, selectPurgeTargets } from './ndjson-quota'
import { createNdjsonWriter, type NdjsonFs, type NdjsonWriter } from './ndjson-writer'

type LogFn = (message?: unknown, ...rest: unknown[]) => void

export interface GuardSnapshot {
  rejectCount: number
  latest: {
    ts: string
    expectedProjectId: string
    receivedProjectId: string
    peer?: { host: string; port: number }
  } | null
}

export interface GuardEventLog {
  recordRejection(event: {
    expectedProjectId: string
    receivedProjectId: string
    isRepeat: boolean
    peer?: { host: string; port: number }
  }): void
  snapshot(): GuardSnapshot
  getCurrentFileName(): string
  dispose(): void
}

export function createGuardEventLog(deps: {
  ndjsonDir: string
  fs: NdjsonFs
  now: () => number
  logError: LogFn
  quota: { limitBytes: number }
}): GuardEventLog {
  const logDirPath = path.resolve(process.cwd(), deps.ndjsonDir)
  const writer: NdjsonWriter = createNdjsonWriter({
    dir: deps.ndjsonDir,
    filePrefix: 'oscdesk-guard',
    now: () => new Date(deps.now()),
    fs: deps.fs,
    logError: deps.logError,
  })

  const enforceQuota = () => {
    try {
      const files = listNdjsonFiles(deps.fs, logDirPath)

      if (!calculateLogUsage({ files, limitBytes: deps.quota.limitBytes }).overLimit) {
        return
      }

      const purgeTargets = selectPurgeTargets({
        files,
        limitBytes: deps.quota.limitBytes,
        currentFileNames: [writer.getCurrentFileName()],
      })

      for (const target of purgeTargets) {
        try {
          deps.fs.unlinkSync(path.join(logDirPath, target))
        } catch (error) {
          deps.logError('(ERROR, CUSTOM MODULE)', `Failed to delete guard log "${target}".`, error)
        }
      }
    } catch (error) {
      deps.logError('(ERROR, CUSTOM MODULE)', 'Failed to enforce guard log quota.', error)
    }
  }

  let count = 0
  let latest: {
    ts: string
    expectedProjectId: string
    receivedProjectId: string
    peer?: { host: string; port: number }
  } | null = null
  let disposed = false

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
        enforceQuota()
        deps.logError(
          '(ERROR, CUSTOM MODULE)',
          `Manifest project mismatch: expected "${event.expectedProjectId}", received "${event.receivedProjectId}".`,
        )
      }

    },

    snapshot() {
      return { rejectCount: count, latest }
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
