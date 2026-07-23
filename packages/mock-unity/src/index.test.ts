import { describe, expect, it } from 'vitest'

import { parseCliArgs } from './index'

describe('parseCliArgs', () => {
  it('parses the required listen port and optional reply target', () => {
    expect(
      parseCliArgs(['--listen-port', '9000', '--reply-host', '127.0.0.1', '--reply-port', '9001']),
    ).toEqual({
      listenPort: 9000,
      replyHost: '127.0.0.1',
      replyPort: 9001,
    })
  })

  it('rejects missing listen port', () => {
    expect(() => parseCliArgs([])).toThrow('Missing required argument: --listen-port')
  })

  it('rejects half-specified reply targets', () => {
    expect(() => parseCliArgs(['--listen-port', '9000', '--reply-host', '127.0.0.1'])).toThrow(
      '--reply-host and --reply-port must be provided together',
    )
  })
})
