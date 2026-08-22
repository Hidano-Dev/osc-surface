import { GuardEventRecordSchema } from '@oscdesk/shared'
import { describe, expect, it, vi } from 'vitest'

import { createGuardEventLog } from './guard-event-log'
import type { NdjsonFs, NdjsonWriteStream } from './ndjson-writer'

function setup(options: {
  quota?: { limitBytes: number }
  files?: Array<{ name: string; size: number; mtimeMs: number }>
  extraProtectedFiles?: () => readonly string[]
} = {}) {
  const files = options.files ?? []
  const writes: string[] = []
  const stream: NdjsonWriteStream = {
    on() {},
    write(chunk) {
      writes.push(chunk)
    },
    end() {},
  }
  const fs: NdjsonFs = {
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => files.map((file) => file.name)),
    statSync: vi.fn((statPath: string) => {
      const file = files.find((candidate) => String(statPath).endsWith(candidate.name))
      return {
        isFile: () => true,
        size: file?.size ?? 0,
        mtimeMs: file?.mtimeMs ?? 0,
      }
    }),
    unlinkSync: vi.fn(),
    createWriteStream: vi.fn(() => stream),
  }
  const logError = vi.fn()
  const log = createGuardEventLog({
    ndjsonDir: 'logs/diagnostics',
    fs,
    now: () => Date.parse('2026-07-26T12:34:56.789Z'),
    logError,
    quota: options.quota ?? { limitBytes: 52_428_800 },
    extraProtectedFiles: options.extraProtectedFiles,
  })

  return { fs, log, logError, writes }
}

describe('createGuardEventLog', () => {
  it('provides an empty snapshot before the first rejection', () => {
    const { log } = setup()

    expect(log.snapshot()).toEqual({ rejectCount: 0, latest: null })
  })

  it('records non-repeated rejections and exposes the latest event in the snapshot', () => {
    const { log, logError, writes } = setup()

    log.recordRejection({
      expectedProjectId: 'expected-project',
      receivedProjectId: 'wrong-project',
      isRepeat: false,
      peer: { host: '127.0.0.1', port: 9000 },
    })

    expect(GuardEventRecordSchema.parse(JSON.parse(writes[0]!))).toEqual({
      ts: '2026-07-26T12:34:56.789Z',
      kind: 'guard-reject',
      expectedProjectId: 'expected-project',
      receivedProjectId: 'wrong-project',
      peer: { host: '127.0.0.1', port: 9000 },
    })
    expect(logError).toHaveBeenCalledTimes(1)
    expect(log.snapshot()).toEqual({
      rejectCount: 1,
      latest: {
        ts: '2026-07-26T12:34:56.789Z',
        expectedProjectId: 'expected-project',
        receivedProjectId: 'wrong-project',
        peer: { host: '127.0.0.1', port: 9000 },
      },
    })
  })

  it('suppresses repeated writes while updating the cumulative snapshot count', () => {
    const { log, logError, writes } = setup()

    log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: false })
    log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: true })
    expect(writes).toHaveLength(1)
    expect(logError).toHaveBeenCalledTimes(1)
    expect(log.snapshot()).toEqual({
      rejectCount: 2,
      latest: {
        ts: '2026-07-26T12:34:56.789Z',
        expectedProjectId: 'expected',
        receivedProjectId: 'wrong',
      },
    })
  })

  it('purges the oldest guard logs when the quota is exceeded, keeping the current file', () => {
    const { fs, log } = setup({
      quota: { limitBytes: 100 },
      files: [
        { name: 'oscdesk-guard-old-a.ndjson', size: 80, mtimeMs: 1 },
        { name: 'oscdesk-guard-old-b.ndjson', size: 80, mtimeMs: 2 },
        { name: 'oscdesk-guard-2026-07-26T12-34-56-789Z.ndjson', size: 10, mtimeMs: 3 },
      ],
    })

    log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: false })

    const unlinked = vi.mocked(fs.unlinkSync).mock.calls.map(([target]) => String(target))
    expect(unlinked.some((target) => target.endsWith('oscdesk-guard-old-a.ndjson'))).toBe(true)
    expect(unlinked.some((target) => target.endsWith('oscdesk-guard-2026-07-26T12-34-56-789Z.ndjson'))).toBe(false)
  })

  it('never purges files reported by extraProtectedFiles (the diagnostics current file)', () => {
    const { fs, log } = setup({
      quota: { limitBytes: 100 },
      files: [
        { name: 'oscdesk-debug-current.ndjson', size: 80, mtimeMs: 1 },
        { name: 'oscdesk-guard-old-a.ndjson', size: 80, mtimeMs: 2 },
        { name: 'oscdesk-guard-2026-07-26T12-34-56-789Z.ndjson', size: 10, mtimeMs: 3 },
      ],
      extraProtectedFiles: () => ['oscdesk-debug-current.ndjson'],
    })

    log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: false })

    const unlinked = vi.mocked(fs.unlinkSync).mock.calls.map(([target]) => String(target))
    expect(unlinked.some((target) => target.endsWith('oscdesk-debug-current.ndjson'))).toBe(false)
    expect(unlinked.some((target) => target.endsWith('oscdesk-guard-old-a.ndjson'))).toBe(true)
  })

  it('does not purge below the quota limit and swallows purge failures', () => {
    const underLimit = setup({
      quota: { limitBytes: 1_000 },
      files: [{ name: 'oscdesk-guard-old-a.ndjson', size: 80, mtimeMs: 1 }],
    })

    underLimit.log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: false })
    expect(underLimit.fs.unlinkSync).not.toHaveBeenCalled()

    const failing = setup({
      quota: { limitBytes: 100 },
      files: [
        { name: 'oscdesk-guard-old-a.ndjson', size: 200, mtimeMs: 1 },
        { name: 'oscdesk-guard-2026-07-26T12-34-56-789Z.ndjson', size: 10, mtimeMs: 2 },
      ],
    })
    vi.mocked(failing.fs.unlinkSync).mockImplementation(() => {
      throw new Error('EACCES')
    })

    expect(() => {
      failing.log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: false })
    }).not.toThrow()
    expect(failing.writes).toHaveLength(1)
    expect(failing.logError).toHaveBeenCalledWith(
      '(ERROR, CUSTOM MODULE)',
      expect.stringContaining('Failed to delete guard log'),
      expect.any(Error),
    )
  })

  it('does not create the log file before the first rejection and disposes the writer', () => {
    const { fs, log, writes } = setup()

    expect(fs.createWriteStream).not.toHaveBeenCalled()
    expect(log.getCurrentFileName()).toBe('oscdesk-guard-2026-07-26T12-34-56-789Z.ndjson')
    log.dispose()
    log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: false })

    expect(writes).toHaveLength(0)
    expect(fs.createWriteStream).not.toHaveBeenCalled()
  })
})
