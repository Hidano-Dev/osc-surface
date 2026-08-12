import { GuardEventRecordSchema, SelfHealEventRecordSchema, SURFACE_DIAG, type SelfHealEventRecord } from '@oscdesk/shared'

import { calculateLogUsage, listNdjsonFiles, selectPurgeTargets } from './ndjson-quota'
import { createNdjsonWriter, type NdjsonFs, type NdjsonWriter } from './ndjson-writer'

const path = loadPathModule()

type ReceiveFn = (address: string, ...args: unknown[]) => void
type LogFn = (message?: unknown, ...rest: unknown[]) => void

export interface GuardEventLog {
  recordRejection(event: {
    expectedProjectId: string
    receivedProjectId: string
    isRepeat: boolean
    peer?: { host: string; port: number }
  }): void
  recordSelfHeal(event: {
    kind: SelfHealEventRecord['healKind']
    detail: string
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
  quota?: { limitBytes: number }
}): GuardEventLog {
  const logDirPath = path.resolve(process.cwd(), deps.ndjsonDir)
  const writer: NdjsonWriter = createNdjsonWriter({
    dir: deps.ndjsonDir,
    filePrefix: 'osc-guard',
    now: () => new Date(deps.now()),
    fs: deps.fs,
    logError: deps.logError,
  })

  const enforceQuota = () => {
    if (deps.quota === undefined) {
      return
    }

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
  let selfHealCount = 0
  let latestSelfHeal: { ts: string; kind: SelfHealEventRecord['healKind']; detail: string } | null = null
  let previousSelfHealKey: string | null = null
  let disposed = false

  const publish = (clientId?: string) => {
    const options = clientId === undefined ? undefined : { clientId }
    const text = latest === null ? '-' : formatPanelText(latest, count)

    if (options === undefined) {
      deps.receiveFn(SURFACE_DIAG.GUARD, text)
      deps.receiveFn(SURFACE_DIAG.SELF_HEAL, formatSelfHealPanelText(latestSelfHeal, selfHealCount))
    } else {
      deps.receiveFn(SURFACE_DIAG.GUARD, text, options)
      deps.receiveFn(SURFACE_DIAG.SELF_HEAL, formatSelfHealPanelText(latestSelfHeal, selfHealCount), options)
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
        enforceQuota()
        deps.logError(
          '(ERROR, CUSTOM MODULE)',
          `Manifest project mismatch: expected "${event.expectedProjectId}", received "${event.receivedProjectId}".`,
        )
      }

      publish()
    },

    recordSelfHeal(event) {
      if (disposed) {
        return
      }

      const ts = new Date(deps.now()).toISOString()
      const key = `${event.kind}:${event.detail}`
      const isRepeat = previousSelfHealKey === key
      previousSelfHealKey = key
      selfHealCount += 1
      latestSelfHeal = { ts, kind: event.kind, detail: event.detail }

      if (!isRepeat) {
        const record = SelfHealEventRecordSchema.parse({
          ts,
          kind: 'self-heal',
          healKind: event.kind,
          detail: event.detail,
        })
        writer.append(record)
        enforceQuota()
        deps.logError(
          event.kind === 'layout-reload-failed' ? '(ERROR, CUSTOM MODULE)' : '(WARN, CUSTOM MODULE)',
          `Self-heal ${event.kind}: ${event.detail}`,
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

function formatSelfHealPanelText(
  event: { ts: string; kind: SelfHealEventRecord['healKind']; detail: string } | null,
  count: number,
): string {
  if (event === null) {
    return '-'
  }

  const kindLabel = {
    'container-injected': 'コンテナ注入',
    'id-collision': 'ID衝突',
    'layout-reload-failed': 'レイアウト再読込失敗',
  }[event.kind]
  return `${event.ts} ${kindLabel} ${event.detail} (計${count}回)`
}

function loadPathModule(): typeof import('node:path') {
  if (typeof nativeRequire === 'function') {
    return nativeRequire('node:path') as typeof import('node:path')
  }

  return require('node:path') as typeof import('node:path')
}
