import { GuardEventRecordSchema } from '@osc-surface/shared'
import { describe, expect, it, vi } from 'vitest'

import { createGuardEventLog } from './guard-event-log'
import type { NdjsonFs, NdjsonWriteStream } from './ndjson-writer'

function setup(options: {
  quota?: { limitBytes: number }
  files?: Array<{ name: string; size: number; mtimeMs: number }>
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
  const receiveFn = vi.fn()
  const logError = vi.fn()
  const log = createGuardEventLog({
    ndjsonDir: 'logs/diagnostics',
    fs,
    now: () => Date.parse('2026-07-26T12:34:56.789Z'),
    receiveFn,
    logError,
    quota: options.quota,
  })

  return { fs, log, logError, receiveFn, writes }
}

describe('createGuardEventLog', () => {
  it('publishes the initial empty value to a newly opened client', () => {
    const { log, receiveFn } = setup()

    log.publishTo('client-1')

    expect(receiveFn).toHaveBeenCalledWith('/surface/diag/guard', '-', { clientId: 'client-1' })
  })

  it('records non-repeated rejections and publishes the panel row', () => {
    const { log, logError, receiveFn, writes } = setup()

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
    expect(receiveFn).toHaveBeenCalledWith(
      '/surface/diag/guard',
      '2026-07-26T12:34:56.789Z 拒否 expected="expected-project" received="wrong-project" @ 127.0.0.1:9000 (計1回)',
    )
  })

  it('suppresses repeated writes while updating the cumulative panel count and supports client replay', () => {
    const { log, logError, receiveFn, writes } = setup()

    log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: false })
    log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: true })
    log.publishTo('client-1')

    expect(writes).toHaveLength(1)
    expect(logError).toHaveBeenCalledTimes(1)
    expect(receiveFn).toHaveBeenLastCalledWith(
      '/surface/diag/guard',
      '2026-07-26T12:34:56.789Z 拒否 expected="expected" received="wrong" (計2回)',
      { clientId: 'client-1' },
    )
  })

  it('purges the oldest guard logs when the quota is exceeded, keeping the current file', () => {
    const { fs, log } = setup({
      quota: { limitBytes: 100 },
      files: [
        { name: 'osc-guard-old-a.ndjson', size: 80, mtimeMs: 1 },
        { name: 'osc-guard-old-b.ndjson', size: 80, mtimeMs: 2 },
        { name: 'osc-guard-2026-07-26T12-34-56-789Z.ndjson', size: 10, mtimeMs: 3 },
      ],
    })

    log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: false })

    const unlinked = vi.mocked(fs.unlinkSync).mock.calls.map(([target]) => String(target))
    expect(unlinked.some((target) => target.endsWith('osc-guard-old-a.ndjson'))).toBe(true)
    expect(unlinked.some((target) => target.endsWith('osc-guard-2026-07-26T12-34-56-789Z.ndjson'))).toBe(false)
  })

  it('does not purge below the quota limit and swallows purge failures', () => {
    const underLimit = setup({
      quota: { limitBytes: 1_000 },
      files: [{ name: 'osc-guard-old-a.ndjson', size: 80, mtimeMs: 1 }],
    })

    underLimit.log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: false })
    expect(underLimit.fs.unlinkSync).not.toHaveBeenCalled()

    const failing = setup({
      quota: { limitBytes: 100 },
      files: [
        { name: 'osc-guard-old-a.ndjson', size: 200, mtimeMs: 1 },
        { name: 'osc-guard-2026-07-26T12-34-56-789Z.ndjson', size: 10, mtimeMs: 2 },
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
    expect(log.getCurrentFileName()).toBe('osc-guard-2026-07-26T12-34-56-789Z.ndjson')
    log.dispose()
    log.recordRejection({ expectedProjectId: 'expected', receivedProjectId: 'wrong', isRepeat: false })

    expect(writes).toHaveLength(0)
    expect(fs.createWriteStream).not.toHaveBeenCalled()
  })
})
