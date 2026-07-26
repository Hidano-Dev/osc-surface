import type { DiagnosticsNdjsonRecord } from '@osc-surface/shared'

const path = loadPathModule()

export interface NdjsonWriteStream {
  on(event: 'error', listener: (error: unknown) => void): unknown
  write(chunk: string): unknown
  end(): unknown
}

export interface NdjsonFs {
  mkdirSync(path: string, options?: { recursive?: boolean }): unknown
  readdirSync(path: string): string[]
  statSync(path: string): {
    isFile(): boolean
    size: number
    mtimeMs: number
  }
  unlinkSync(path: string): unknown
  createWriteStream(
    path: string,
    options: {
      flags: 'a'
      encoding: 'utf8'
    },
  ): NdjsonWriteStream
}

export interface NdjsonWriter {
  append(record: DiagnosticsNdjsonRecord): void
  getCurrentFileName(): string
  dispose(): void
}

export function createNdjsonWriter(options: {
  dir: string
  filePrefix?: string
  now: () => Date
  fs: NdjsonFs
  logError: (message?: unknown, ...rest: unknown[]) => void
}): NdjsonWriter {
  const resolvedDir = path.resolve(process.cwd(), options.dir)
  const fileName = `${options.filePrefix ?? 'osc-debug'}-${toSafeTimestamp(options.now())}.ndjson`
  const filePath = path.join(resolvedDir, fileName)

  let degraded = false
  let stream: NdjsonWriteStream | null = null

  const degrade = (error: unknown) => {
    if (degraded) {
      return
    }

    degraded = true

    try {
      stream?.end()
    } catch {
      // Ignore cleanup failures after degrading the writer.
    }

    stream = null
    options.logError('(ERROR, CUSTOM MODULE)', `Failed to write NDJSON log at "${filePath}".`, error)
  }

  const open = () => {
    if (degraded || stream !== null) {
      return
    }

    try {
      options.fs.mkdirSync(resolvedDir, { recursive: true })
      stream = options.fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' })
      stream.on('error', degrade)
    } catch (error) {
      degrade(error)
    }
  }

  return {
    append(record) {
      if (degraded || stream === null) {
        open()
      }

      if (degraded || stream === null) {
        return
      }

      try {
        stream.write(`${JSON.stringify(record)}\n`)
      } catch (error) {
        degrade(error)
      }
    },

    getCurrentFileName() {
      return fileName
    },

    dispose() {
      if (stream === null) {
        return
      }

      const activeStream = stream
      stream = null

      try {
        activeStream.end()
      } catch {
        // Disposal must never surface stream shutdown failures.
      }
    },
  }
}

function toSafeTimestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, '-')
}

function loadPathModule(): typeof import('node:path') {
  if (typeof nativeRequire === 'function') {
    return nativeRequire('node:path') as typeof import('node:path')
  }

  return require('node:path') as typeof import('node:path')
}
