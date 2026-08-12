import { SURFACE_DIAG, type DiagnosticsSnapshot, type MessageRecord, type RecordedArg } from '@oscdesk/shared'

const DIAG_PANEL_UPDATE_INTERVAL_MS = 100
const BYTES_PER_MEGABYTE = 1024 * 1024

type TimerHandle = ReturnType<typeof setInterval>
type ReceiveFn = (address: string, ...args: unknown[]) => void
type SetIntervalFn = (callback: () => void, intervalMs: number) => TimerHandle
type ClearIntervalFn = (handle: TimerHandle) => void

export interface DiagPanelSink {
  markDirty(): void
  dispose(): void
}

export function createDiagPanelSink(options: {
  getSnapshot: () => DiagnosticsSnapshot
  receiveFn: ReceiveFn
  setIntervalFn?: SetIntervalFn
  clearIntervalFn?: ClearIntervalFn
}): DiagPanelSink {
  const setIntervalFn = options.setIntervalFn ?? setInterval
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval

  let dirty = false
  let disposed = false
  const timer = setIntervalFn(() => {
    if (!dirty || disposed) {
      return
    }

    dirty = false
    publishSnapshot(options.receiveFn, options.getSnapshot())
  }, DIAG_PANEL_UPDATE_INTERVAL_MS)

  return {
    markDirty() {
      if (disposed) {
        return
      }

      dirty = true
    },

    dispose() {
      if (disposed) {
        return
      }

      disposed = true
      dirty = false
      clearIntervalFn(timer)
    },
  }
}

function publishSnapshot(receiveFn: ReceiveFn, snapshot: DiagnosticsSnapshot): void {
  receiveFn(SURFACE_DIAG.REACHABILITY, formatReachability(snapshot))
  receiveFn(SURFACE_DIAG.RTT, formatRtt(snapshot))
  receiveFn(SURFACE_DIAG.LOSS_RATE, formatLossRate(snapshot))
  receiveFn(SURFACE_DIAG.SUBNET, formatSubnet(snapshot))
  receiveFn(SURFACE_DIAG.LOG_USAGE, formatLogUsage(snapshot))
  receiveFn(SURFACE_DIAG.MESSAGES, formatRecentMessages(snapshot.recentMessages))
}

function formatReachability(snapshot: DiagnosticsSnapshot): string {
  switch (snapshot.reachability) {
    case 'reachable':
      return '到達'
    case 'lost':
      return '喪失'
    case 'unknown':
      return '未確立'
  }
}

function formatRtt(snapshot: DiagnosticsSnapshot): string {
  return snapshot.lastRttMs === null ? '-' : String(snapshot.lastRttMs)
}

function formatLossRate(snapshot: DiagnosticsSnapshot): string {
  if (snapshot.lossRate.observed === 0 || snapshot.lossRate.rate === null) {
    return '-'
  }

  return `${formatPercentage(snapshot.lossRate.rate)} (${snapshot.lossRate.lost}/${snapshot.lossRate.observed})`
}

function formatSubnet(snapshot: DiagnosticsSnapshot): string {
  switch (snapshot.subnet.kind) {
    case 'sameHost':
      return '同一ホスト'
    case 'sameSubnet':
      return `同一サブネット (${snapshot.subnet.matchedInterface})`
    case 'differentSubnet':
      return '別サブネットの疑いあり'
    case 'indeterminate':
      return `判定不能 (${formatIndeterminateReason(snapshot.subnet.reason)})`
  }
}

function formatIndeterminateReason(reason: DiagnosticsSnapshot['subnet'] extends { reason: infer T } ? T : never): string {
  switch (reason) {
    case 'hostname':
      return 'ホスト名'
    case 'ipv6Destination':
      return 'IPv6 宛先'
    case 'noIpv4Interface':
      return 'IPv4 IF なし'
  }
}

function formatLogUsage(snapshot: DiagnosticsSnapshot): string {
  const totalMegabytes = formatMegabytes(snapshot.logUsage.totalBytes)
  const limitMegabytes = formatMegabytes(snapshot.logUsage.limitBytes)
  const summary = `${totalMegabytes}/${limitMegabytes} MB`

  return snapshot.logUsage.overLimit ? `警告: ${summary}` : summary
}

function formatMegabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(1)
}

function formatPercentage(rate: number): string {
  const percentage = rate * 100

  if (Number.isInteger(percentage)) {
    return `${percentage}%`
  }

  return `${percentage.toFixed(1)}%`
}

function formatRecentMessages(messages: readonly MessageRecord[]): string {
  if (messages.length === 0) {
    return '-'
  }

  return messages.map(formatMessage).join('\n')
}

function formatMessage(message: MessageRecord): string {
  const peer = message.peer === undefined ? '' : ` @ ${message.peer.host}:${message.peer.port}`
  return `${message.ts} [${message.dir}] ${message.address} ${formatArgs(message.args)}${peer}`
}

function formatArgs(args: readonly RecordedArg[]): string {
  if (args.length === 0) {
    return '[]'
  }

  return `[${args.map(formatArg).join(', ')}]`
}

function formatArg(arg: RecordedArg): string {
  if (arg.kind === 'blob') {
    return `blob:${arg.byteLength}`
  }

  const value = typeof arg.value === 'string' ? JSON.stringify(arg.value) : String(arg.value)
  const suffix = arg.truncated ? '…' : ''
  return `${arg.type}:${value}${suffix}`
}
