import { GuardEventRecordSchema } from '@osc-surface/shared'
import { describe, expect, it, vi } from 'vitest'

import { createGuardEventLog } from './guard-event-log'
import type { NdjsonFs, NdjsonWriteStream } from './ndjson-writer'

function setup() {
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
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isFile: () => true, size: 0, mtimeMs: 0 })),
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
