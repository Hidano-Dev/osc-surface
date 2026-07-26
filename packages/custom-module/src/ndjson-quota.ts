export interface LogFileInfo {
  name: string
  sizeBytes: number
  mtimeMs: number
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
