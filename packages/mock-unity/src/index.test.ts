import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { main, parseCliArgs } from './index'

const { startMockUnityServerMock } = vi.hoisted(() => ({
  startMockUnityServerMock: vi.fn(),
}))

vi.mock('./server', () => ({
  startMockUnityServer: startMockUnityServerMock,
}))

describe('parseCliArgs', () => {
  it('parses the required listen port and optional reply target', () => {
    expect(
      parseCliArgs(['--listen-port', '9000', '--reply-host', '127.0.0.1', '--reply-port', '9001']),
    ).toEqual({
      listenPort: 9000,
      replyHost: '127.0.0.1',
      replyPort: 9001,
      scenarioPath: undefined,
      characterName: undefined,
    })
  })

  it('parses scenario and character name overrides', () => {
    expect(
      parseCliArgs([
        '--listen-port',
        '9000',
        '--scenario',
        'packages/mock-unity/scenarios/invalid-manifest.json',
        '--character-name',
        '蛻晞浹繝溘け',
      ]),
    ).toEqual({
      listenPort: 9000,
      replyHost: undefined,
      replyPort: undefined,
      scenarioPath: path.resolve('packages/mock-unity/scenarios/invalid-manifest.json'),
      characterName: '蛻晞浹繝溘け',
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

  it('rejects --character-name without --scenario', () => {
    expect(() => parseCliArgs(['--listen-port', '9000', '--character-name', '蛻晞浹繝溘け'])).toThrow(
      '--character-name requires --scenario',
    )
  })
})

describe('main', () => {
  const stdoutWrite = vi.spyOn(process.stdout, 'write')

  afterEach(() => {
    stdoutWrite.mockReset()
    startMockUnityServerMock.mockReset()
  })

  it('starts the server with a scenario-backed responder and prints READY metadata', async () => {
    const close = vi.fn(async () => undefined)
    startMockUnityServerMock.mockResolvedValue({
      listenPort: 9010,
      close,
    })

    stdoutWrite.mockReturnValue(true)

    await main([
      '--listen-port',
      '9000',
      '--reply-host',
      '127.0.0.1',
      '--reply-port',
      '9001',
      '--scenario',
      'packages/mock-unity/scenarios/default.json',
      '--character-name',
      '髀｡髻ｳ繝ｪ繝ｳ',
    ])

    expect(startMockUnityServerMock).toHaveBeenCalledTimes(1)
    expect(startMockUnityServerMock.mock.calls[0]?.[0]).toMatchObject({
      listenPort: 9000,
      replyTarget: {
        host: '127.0.0.1',
        port: 9001,
      },
    })

    const responder = startMockUnityServerMock.mock.calls[0]?.[0]?.responder
    expect(responder.handlePacket({ address: '/avatar/name', args: [] })).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/avatar/name',
          args: [],
        },
      },
    ])
    const manifestReply = responder.handlePacket({ address: '/sys/manifest/request', args: [] })[0]
    expect(manifestReply).toMatchObject({
      kind: 'message',
      packet: {
        address: '/sys/manifest',
        args: [{ type: 's' }],
      },
    })
    expect(JSON.parse(String(manifestReply?.packet.args[0]?.value))).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining('髀｡髻ｳ繝ｪ繝ｳ'),
        }),
      ]),
    })

    expect(stdoutWrite).toHaveBeenCalledWith(
      `${'MOCK_UNITY_READY'} ${JSON.stringify({
        listenPort: 9010,
        scenarioPath: path.resolve('packages/mock-unity/scenarios/default.json'),
        characterName: '髀｡髻ｳ繝ｪ繝ｳ',
      })}\n`,
    )
  })

  it('starts without a scenario, keeps the manifest request unanswered, and omits scenario metadata from READY', async () => {
    const close = vi.fn(async () => undefined)
    startMockUnityServerMock.mockResolvedValue({
      listenPort: 9020,
      close,
    })

    stdoutWrite.mockReturnValue(true)

    await main(['--listen-port', '9000'])

    const responder = startMockUnityServerMock.mock.calls[0]?.[0]?.responder
    expect(responder.handlePacket({ address: '/avatar/name', args: [] })).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/avatar/name',
          args: [],
        },
      },
    ])
    expect(responder.handlePacket({ address: '/sys/manifest/request', args: [] })).toEqual([])

    expect(stdoutWrite).toHaveBeenCalledWith(
      `${'MOCK_UNITY_READY'} ${JSON.stringify({ listenPort: 9020 })}\n`,
    )
  })
})
