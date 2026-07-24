import { MessageRecordSchema, type MessageRecord } from '@osc-surface/shared'
import { describe, expect, it, vi } from 'vitest'

import { createNdjsonWriter, type NdjsonFs, type NdjsonWriteStream } from './ndjson-writer'

function createRecord(): MessageRecord {
  return {
    ts: '2026-07-24T12:34:56.000Z',
    dir: 'out',
    address: '/avatar/position',
    args: [{ kind: 'value', type: 'f', value: 1.5 }],
    peer: {
      host: '127.0.0.1',
      port: 9000,
    },
  }
}

describe('createNdjsonWriter', () => {
  it('appends one schema-valid record per line to a session-specific file', () => {
    const writes: string[] = []
    let errorListener: ((error: unknown) => void) | undefined
    const stream: NdjsonWriteStream = {
      on(event, listener) {
        if (event === 'error') {
          errorListener = listener
        }
      },
      write(chunk) {
        writes.push(chunk)
      },
      end() {},
    }
    const fs: NdjsonFs = {
      mkdirSync: vi.fn(),
      createWriteStream: vi.fn(() => stream),
    }
    const logError = vi.fn()

    const writer = createNdjsonWriter({
      dir: 'logs/diagnostics',
      now: () => new Date('2026-07-24T12:34:56.789Z'),
      fs,
      logError,
    })

    writer.append(createRecord())
    writer.dispose()

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringMatching(/logs[\\/]diagnostics$/), {
      recursive: true,
    })
    expect(fs.createWriteStream).toHaveBeenCalledWith(
      expect.stringMatching(/osc-debug-2026-07-24T12-34-56-789Z\.ndjson$/),
      { flags: 'a', encoding: 'utf8' },
    )
    expect(errorListener).toBeTypeOf('function')
    expect(writes).toHaveLength(1)
    expect(writes[0].endsWith('\n')).toBe(true)
    expect(MessageRecordSchema.parse(JSON.parse(writes[0].trim()))).toEqual(createRecord())
    expect(logError).not.toHaveBeenCalled()
  })

  it('degrades without throwing when directory creation fails', () => {
    const fs: NdjsonFs = {
      mkdirSync: vi.fn(() => {
        throw new Error('mkdir failed')
      }),
      createWriteStream: vi.fn(),
    }
    const logError = vi.fn()

    const writer = createNdjsonWriter({
      dir: 'logs/diagnostics',
      now: () => new Date('2026-07-24T12:34:56.789Z'),
      fs,
      logError,
    })

    expect(() => writer.append(createRecord())).not.toThrow()
    expect(() => writer.dispose()).not.toThrow()
    expect(fs.createWriteStream).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledTimes(1)
  })

  it('degrades once and turns subsequent appends into no-ops after a stream write failure', () => {
    const writes: string[] = []
    let failWrite = true
    let endCalls = 0
    const stream: NdjsonWriteStream = {
      on() {},
      write(chunk) {
        if (failWrite) {
          failWrite = false
          throw new Error('write failed')
        }

        writes.push(chunk)
      },
      end() {
        endCalls += 1
      },
    }
    const fs: NdjsonFs = {
      mkdirSync: vi.fn(),
      createWriteStream: vi.fn(() => stream),
    }
    const logError = vi.fn()

    const writer = createNdjsonWriter({
      dir: 'logs/diagnostics',
      now: () => new Date('2026-07-24T12:34:56.789Z'),
      fs,
      logError,
    })

    expect(() => writer.append(createRecord())).not.toThrow()
    expect(() => writer.append(createRecord())).not.toThrow()
    expect(() => writer.dispose()).not.toThrow()

    expect(writes).toEqual([])
    expect(endCalls).toBe(1)
    expect(logError).toHaveBeenCalledTimes(1)
  })
})
