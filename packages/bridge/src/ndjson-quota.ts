import path from 'node:path'

import type { NdjsonFs } from './ndjson-writer'

export interface LogFileInfo {
  name: string
  sizeBytes: number
  mtimeMs: number
}

/**
 * ログディレクトリ内の .ndjson を列挙する。
 *
 * ディレクトリは NDJSON writer が初回書き込み時に遅延作成するため、
 * 起動直後や新規クローン直後にはまだ存在しない。その場合は「ファイル 0 件」として扱う
 * (存在しないこと自体はエラーではない)。それ以外の失敗は呼び出し元へ伝える。
 */
export function listNdjsonFiles(fs: NdjsonFs, dirPath: string): LogFileInfo[] {
  let names: string[]

  try {
    names = fs.readdirSync(dirPath)
  } catch (error) {
    if (isMissingDirectory(error)) {
      return []
    }

    throw error
  }

  return names
    .filter((name) => name.endsWith('.ndjson'))
    .map((name) => {
      const stat = fs.statSync(path.join(dirPath, name))

      if (!stat.isFile()) {
        return null
      }

      return {
        name,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
      }
    })
    .filter((file): file is LogFileInfo => file !== null)
}

function isMissingDirectory(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

export interface LogUsage {
  totalBytes: number
  limitBytes: number
  overLimit: boolean
}

export function calculateLogUsage(options: {
  files: readonly LogFileInfo[]
  limitBytes: number
}): LogUsage {
  const totalBytes = options.files.reduce((sum, file) => sum + file.sizeBytes, 0)

  return {
    totalBytes,
    limitBytes: options.limitBytes,
    overLimit: totalBytes > options.limitBytes,
  }
}

export function selectPurgeTargets(options: {
  files: readonly LogFileInfo[]
  limitBytes: number
  currentFileNames: readonly string[]
}): readonly string[] {
  const targetBytes = options.limitBytes * 0.9
  const purgeTargets: string[] = []
  let selectedBytes = 0

  const candidates = [...options.files]
    .filter((file) => !options.currentFileNames.includes(file.name))
    .sort((left, right) => {
      if (left.mtimeMs !== right.mtimeMs) {
        return left.mtimeMs - right.mtimeMs
      }

      return left.name.localeCompare(right.name)
    })

  for (const candidate of candidates) {
    purgeTargets.push(candidate.name)
    selectedBytes += candidate.sizeBytes

    if (selectedBytes >= targetBytes) {
      break
    }
  }

  return purgeTargets
}
