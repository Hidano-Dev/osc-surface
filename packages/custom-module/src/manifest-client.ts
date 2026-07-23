import { ManifestSchema, type Manifest } from '@osc-surface/shared'

const DEFAULT_REQUEST_INTERVAL_MS = 2000

export type ManifestRejectReason = 'json-parse-error' | 'schema-error'

export type ManifestReceiveResult =
  | { accepted: true; manifest: Manifest }
  | { accepted: false; reason: ManifestRejectReason; detail: string; isRepeat: boolean }

type ManifestClientState = 'requesting' | 'settled'

export class ManifestClient {
  private readonly requestIntervalMs: number
  private state: ManifestClientState = 'requesting'
  private lastRequestAtMs: number | null = null
  private lastRejectKey: string | null = null
  private latestManifest: Manifest | null = null

  constructor(options?: { requestIntervalMs?: number }) {
    this.requestIntervalMs = options?.requestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS
  }

  shouldRequest(nowMs: number): boolean {
    if (this.state !== 'requesting') {
      return false
    }

    if (this.lastRequestAtMs === null) {
      return true
    }

    return nowMs - this.lastRequestAtMs >= this.requestIntervalMs
  }

  onRequestSent(nowMs: number): void {
    this.lastRequestAtMs = nowMs
  }

  onManifestPayload(json: string): ManifestReceiveResult {
    let parsedJson: unknown

    try {
      parsedJson = JSON.parse(json)
    } catch (error) {
      return this.reject('json-parse-error', formatJsonParseError(error))
    }

    const result = ManifestSchema.safeParse(parsedJson)

    if (!result.success) {
      return this.reject('schema-error', formatSchemaError(result.error.issues))
    }

    this.latestManifest = result.data
    this.state = 'settled'
    this.lastRejectKey = null

    return {
      accepted: true,
      manifest: result.data,
    }
  }

  onReachabilityRecovered(): void {
    this.state = 'requesting'
    this.lastRequestAtMs = null
    this.lastRejectKey = null
  }

  current(): Manifest | null {
    return this.latestManifest
  }

  private reject(reason: ManifestRejectReason, detail: string): ManifestReceiveResult {
    this.state = 'requesting'

    const rejectKey = `${reason}:${detail}`
    const isRepeat = rejectKey === this.lastRejectKey

    this.lastRejectKey = rejectKey

    return {
      accepted: false,
      reason,
      detail,
      isRepeat,
    }
  }
}

function formatJsonParseError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return 'Failed to parse manifest JSON.'
}

function formatSchemaError(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
): string {
  return issues
    .map((issue) => {
      const pathLabel = issue.path.length > 0 ? issue.path.join('.') : '<root>'
      return `${pathLabel}: ${issue.message}`
    })
    .join('; ')
}
