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
  it('parses a project identifier override and requires a scenario', () => {
    expect(
      parseCliArgs([
        '--listen-port',
        '9000',
        '--scenario',
        'packages/mock-unity/scenarios/default.json',
        '--project-id',
        'alternate-project',
      ]),
    ).toMatchObject({
      projectId: 'alternate-project',
      scenarioPath: path.resolve('packages/mock-unity/scenarios/default.json'),
    })

    expect(() => parseCliArgs(['--listen-port', '9000', '--project-id', 'alternate-project'])).toThrow(
      '--project-id requires --scenario',
    )
  })

  it('parses the required listen port and optional reply target', () => {
    expect(
      parseCliArgs(['--listen-port', '9000', '--reply-host', '127.0.0.1', '--reply-port', '9001']),
    ).toEqual({
      listenPort: 9000,
      replyHost: '127.0.0.1',
      replyPort: 9001,
      scenarioPath: undefined,
      characterName: undefined,
      faultMode: { kind: 'none' },
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
        '初音ミク',
      ]),
    ).toEqual({
      listenPort: 9000,
      replyHost: undefined,
      replyPort: undefined,
      scenarioPath: path.resolve('packages/mock-unity/scenarios/invalid-manifest.json'),
      characterName: '初音ミク',
      faultMode: { kind: 'none' },
    })
  })

  it('parses --fault with parameterized modes', () => {
    expect(parseCliArgs(['--listen-port', '9000', '--fault', 'delay:150'])).toEqual({
      listenPort: 9000,
      replyHost: undefined,
      replyPort: undefined,
      scenarioPath: undefined,
      characterName: undefined,
      faultMode: { kind: 'delay', ms: 150 },
    })

    expect(parseCliArgs(['--listen-port', '9000', '--fault', 'random-loss:0.5'])).toEqual({
      listenPort: 9000,
      replyHost: undefined,
      replyPort: undefined,
      scenarioPath: undefined,
      characterName: undefined,
      faultMode: { kind: 'random-loss', rate: 0.5 },
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
    expect(() => parseCliArgs(['--listen-port', '9000', '--character-name', '初音ミク'])).toThrow(
      '--character-name requires --scenario',
    )
  })

  it('rejects invalid fault mode syntax', () => {
    expect(() => parseCliArgs(['--listen-port', '9000', '--fault', 'delay:-1'])).toThrow(
      'Invalid fault mode for --fault: delay:-1',
    )
  })
})

describe('main', () => {
  const stdoutWrite = vi.spyOn(process.stdout, 'write')

  afterEach(() => {
    stdoutWrite.mockReset()
    startMockUnityServerMock.mockReset()
  })

  it('includes the resolved project identifier in READY and startup manifest metadata', async () => {
    startMockUnityServerMock.mockResolvedValue({ listenPort: 9010, close: vi.fn(async () => undefined) })
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
      '--project-id',
      'alternate-project',
    ])

    const serverOptions = startMockUnityServerMock.mock.calls[0]?.[0]
    expect(serverOptions.startupReplies).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/sys/manifest',
          args: [{ type: 's', value: expect.any(String) }],
        },
      },
    ])
    expect(JSON.parse(String(serverOptions.startupReplies[0].packet.args[0].value))).toMatchObject({
      projectId: 'alternate-project',
    })
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('"projectId":"alternate-project"'),
    )
  })

  it('starts the server with a scenario-backed responder, injects the fault mode, and prints READY metadata', async () => {
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
      '鏡音リン',
      '--fault',
      'delay:150',
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
    expect(
      responder.handlePacket({
        address: '/sys/ping',
        args: [{ type: 'i', value: 7 }],
      }),
    ).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/sys/pong',
          args: [{ type: 'i', value: 7 }],
        },
        delayMs: 150,
      },
    ])
    expect(JSON.parse(String(manifestReply?.packet.args[0]?.value))).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining('鏡音リン'),
        }),
      ]),
    })

    expect(stdoutWrite).toHaveBeenCalledWith(
      `${'MOCK_UNITY_READY'} ${JSON.stringify({
        listenPort: 9010,
        scenarioPath: path.resolve('packages/mock-unity/scenarios/default.json'),
        characterName: '鏡音リン',
        projectId: 'oscdesk-demo',
        fault: { kind: 'delay', ms: 150 },
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
      `${'MOCK_UNITY_READY'} ${JSON.stringify({ listenPort: 9020, fault: { kind: 'none' } })}\n`,
    )
  })
})
