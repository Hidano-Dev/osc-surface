import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { ProcessHarness, type ManagedProcess } from './helpers/process'
import { reserveUdpPort } from './helpers/ports'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

describe('WebSocket protocol round trip', () => {
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

  test('preserves the connection sequence and typed single-argument UDP echo', async () => {
    const wsPort = await reserveUdpPort()
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

    const initialFrames = [await client.nextFrame(), await client.nextFrame(), await client.nextFrame()]
    expect(initialFrames.map((frame) => frame.type)).toEqual(['hello', 'link', 'manifest'])
    expect(initialFrames[0]).toMatchObject({ type: 'hello', protocolVersion: 1 })
    expect(initialFrames[1]).toMatchObject({ type: 'link', unity: { reachability: 'unknown' } })
    expect(initialFrames[2]).toMatchObject({
      type: 'manifest',
      manifest: { projectId: 'osc-surface-demo' },
    })

    client.sendOsc('/avatar/blend/smile', [{ type: 'f', value: 0.73 }])
    const echo = await client.waitForFrame(
      (frame) => frame.type === 'osc' && frame.address === '/avatar/blend/smile',
      5_000,
    )

    expect(echo.type).toBe('osc')
    expect(Array.isArray(echo.args)).toBe(true)
    expect(echo.args).toEqual([{ type: 'f', value: expect.closeTo(0.73, 5) }])
  })

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
