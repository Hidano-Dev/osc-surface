import { describe, expect, it } from 'vitest'

import { calculateLogUsage, selectPurgeTargets, type LogFileInfo } from './ndjson-quota'

describe('calculateLogUsage', () => {
  it('sums file sizes and reports when the limit is exceeded', () => {
    const files: LogFileInfo[] = [
      { name: 'osc-debug-1.ndjson', sizeBytes: 1_024, mtimeMs: 100 },
      { name: 'osc-debug-2.ndjson', sizeBytes: 2_048, mtimeMs: 200 },
    ]

    expect(
      calculateLogUsage({
        files,
        limitBytes: 3_072,
      }),
    ).toEqual({
      totalBytes: 3_072,
      limitBytes: 3_072,
      overLimit: false,
    })

    expect(
      calculateLogUsage({
        files,
        limitBytes: 3_071,
      }),
    ).toEqual({
      totalBytes: 3_072,
      limitBytes: 3_071,
      overLimit: true,
    })
  })
})

describe('selectPurgeTargets', () => {
  it('selects oldest files until cumulative deleted bytes reach 90 percent of the limit', () => {
    const files: LogFileInfo[] = [
      { name: 'osc-debug-01.ndjson', sizeBytes: 20, mtimeMs: 100 },
      { name: 'osc-debug-02.ndjson', sizeBytes: 40, mtimeMs: 200 },
      { name: 'osc-debug-03.ndjson', sizeBytes: 50, mtimeMs: 300 },
      { name: 'osc-debug-04.ndjson', sizeBytes: 80, mtimeMs: 400 },
    ]

    expect(
      selectPurgeTargets({
        files,
        limitBytes: 100,
        currentFileNames: ['osc-debug-04.ndjson'],
      }),
    ).toEqual(['osc-debug-01.ndjson', 'osc-debug-02.ndjson', 'osc-debug-03.ndjson'])
  })

  it('never returns the current file even when it is the oldest entry', () => {
    const files: LogFileInfo[] = [
      { name: 'osc-debug-current.ndjson', sizeBytes: 200, mtimeMs: 100 },
      { name: 'osc-debug-02.ndjson', sizeBytes: 40, mtimeMs: 200 },
      { name: 'osc-debug-03.ndjson', sizeBytes: 60, mtimeMs: 300 },
    ]

    expect(
      selectPurgeTargets({
        files,
        limitBytes: 100,
        currentFileNames: ['osc-debug-current.ndjson'],
      }),
    ).toEqual(['osc-debug-02.ndjson', 'osc-debug-03.ndjson'])
  })

  it('returns all eligible files when the 90 percent target cannot be reached', () => {
    const files: LogFileInfo[] = [
      { name: 'osc-debug-01.ndjson', sizeBytes: 10, mtimeMs: 100 },
      { name: 'osc-debug-02.ndjson', sizeBytes: 15, mtimeMs: 200 },
      { name: 'osc-debug-current.ndjson', sizeBytes: 100, mtimeMs: 300 },
    ]

    expect(
      selectPurgeTargets({
        files,
        limitBytes: 100,
        currentFileNames: ['osc-debug-current.ndjson'],
      }),
    ).toEqual(['osc-debug-01.ndjson', 'osc-debug-02.ndjson'])
  })

  it('breaks ties deterministically by file name when mtimes are equal', () => {
    const files: LogFileInfo[] = [
      { name: 'osc-debug-b.ndjson', sizeBytes: 50, mtimeMs: 100 },
      { name: 'osc-debug-a.ndjson', sizeBytes: 50, mtimeMs: 100 },
      { name: 'osc-debug-current.ndjson', sizeBytes: 50, mtimeMs: 300 },
    ]

    expect(
      selectPurgeTargets({
        files,
        limitBytes: 100,
        currentFileNames: ['osc-debug-current.ndjson'],
      }),
    ).toEqual(['osc-debug-a.ndjson', 'osc-debug-b.ndjson'])
  })

  it('protects multiple files currently being written', () => {
    const files: LogFileInfo[] = [
      { name: 'osc-debug-current.ndjson', sizeBytes: 200, mtimeMs: 100 },
      { name: 'osc-guard-current.ndjson', sizeBytes: 200, mtimeMs: 200 },
      { name: 'osc-debug-old.ndjson', sizeBytes: 40, mtimeMs: 300 },
    ]

    expect(
      selectPurgeTargets({
        files,
        limitBytes: 100,
        currentFileNames: ['osc-debug-current.ndjson', 'osc-guard-current.ndjson'],
      }),
    ).toEqual(['osc-debug-old.ndjson'])
  })
})
