import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { ProcessHarness, type ManagedProcess } from './helpers/process'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

describe('WebSocket invalid-frame robustness', () => {
  const mockHarness = new ProcessHarness()
  let bridge: BridgeProcess | undefined
  let client: WsE2eClient | undefined

  afterEach(async () => {
    await client?.close().catch(() => undefined)
    client = undefined
    await mockHarness.stopAll()
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
  })

  test('keeps one connection alive through invalid frames and accepts a later value', async () => {
    const wsPort = await reserveTcpPort()
    const oscListenPort = await reserveUdpPort()
    const unityPort = await reserveUdpPort()

    await startMockUnity(unityPort, oscListenPort)
    bridge = await startBridge({
      wsPort,
      oscListenPort,
      unityHost: '127.0.0.1',
      unityPort,
      readyTimeoutMs: 30_000,
    })
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)

    await client.nextFrame()
    await client.nextFrame()
    await client.nextFrame()

    client.sendRaw(JSON.stringify(['sendOsc', { address: '/avatar/blend/smile', v: 0.25 }]))
    await expectInvalidFrameNotice('schema-error')

    client.sendRaw(JSON.stringify({ v: 1, type: 'osc', address: '/avatar/blend/smile', args: [], extra: true }))
    await expectInvalidFrameNotice('schema-error')

    client.sendRaw('{')
    await expectInvalidFrameNotice('invalid-json')

    client.sendOsc('/avatar/blend/smile', [{ type: 'f', value: 0.73 }])
    const echo = await client.waitForFrame(
      (frame) => frame.type === 'osc' && frame.address === '/avatar/blend/smile',
      5_000,
    )

    expect(echo.type).toBe('osc')
    expect(echo.args).toEqual([{ type: 'f', value: expect.closeTo(0.73, 5) }])
  })

  async function expectInvalidFrameNotice(detail: 'schema-error' | 'invalid-json'): Promise<void> {
    const notice = await client?.waitForFrame((frame) => frame.type === 'notice', 5_000)
    expect(notice).toMatchObject({ type: 'notice', code: 'invalid-frame', level: 'warn', detail })
  }

  async function startMockUnity(listenPort: number, replyPort: number): Promise<ManagedProcess> {
    return mockHarness.start({
      command: process.execPath,
      args: [
        path.resolve('packages/mock-unity/dist/mock-unity.js'),
        '--listen-port', String(listenPort),
        '--reply-host', '127.0.0.1',
        '--reply-port', String(replyPort),
        '--scenario', path.resolve('packages/mock-unity/scenarios/default.json'),
      ],
      readyPattern: /MOCK_UNITY_READY/,
      readyTimeoutMs: 10_000,
    })
  }
})
