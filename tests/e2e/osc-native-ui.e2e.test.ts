import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'

import { SURFACE, type SurfaceConfig } from '../../packages/shared/src'

import { createOscTestClient, type OscTestClient } from './helpers/osc-client'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { ProcessHarness } from './helpers/process'

/**
 * TouchOSC などの OSC ネイティブ UI を UI として使う構成の疎通確認。
 *
 * O-S-C 本体は無改造で、UI からの OSC を Unity へ、Unity のエコーバックを UI へ
 * 中継するのは custom module の oscUi ルーター(packages/custom-module/src/osc-ui-router.ts)。
 * ここでは UDP クライアントを TouchOSC 役に見立てて往復を検証する。
 */

const EVAL_SCENARIO = 'packages/mock-unity/scenarios/touchosc-eval.json'
const EVAL_PROJECT_ID = 'osc-surface-touchosc-eval'
const LIGHT_ADDRESS = '/stage/light/intensity'

interface Chain {
  httpPort: number
  surfacePort: number
  unityPort: number
  uiPort: number
}

describe('OSC-native UI (TouchOSC role) round trip', () => {
  const harness = new ProcessHarness()
  const originalSurfaceConfigEnv = process.env.OSC_SURFACE_CONFIG
  let uiClient: OscTestClient | undefined
  let tempDir: string | undefined

  beforeEach(() => {
    uiClient = undefined
    tempDir = undefined
  })

  afterEach(async () => {
    await uiClient?.close().catch(() => undefined)
    await harness.stopAll()
    process.env.OSC_SURFACE_CONFIG = originalSurfaceConfigEnv

    if (tempDir !== undefined) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  afterAll(async () => {
    await harness.stopAll()
    process.env.OSC_SURFACE_CONFIG = originalSurfaceConfigEnv
  })

  async function startChain(oscUiEnabled: boolean): Promise<Chain> {
    const chain: Chain = {
      httpPort: await reserveTcpPort(),
      surfacePort: await reserveUdpPort(),
      unityPort: await reserveUdpPort(),
      uiPort: await reserveUdpPort(),
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osc-surface-native-ui-'))
    const configPath = path.join(tempDir, 'surface.config.json')

    const config: SurfaceConfig = {
      unity: {
        host: '127.0.0.1',
        sendPort: chain.unityPort,
        receivePort: chain.surfacePort,
      },
      debug: false,
      boolFallbackToInt: false,
      expectedProjectId: EVAL_PROJECT_ID,
      diagnostics: {
        ringBufferSize: 200,
        lossRateWindow: 30,
        ndjsonDir: path.join(tempDir, 'diagnostics'),
        ndjsonMaxTotalBytes: 52_428_800,
      },
      oscUi: {
        enabled: oscUiEnabled,
        staticPeers: [],
        peerTtlMs: 0,
      },
    }

    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    process.env.OSC_SURFACE_CONFIG = configPath

    await harness.start({
      command: process.execPath,
      args: [
        'packages/mock-unity/dist/mock-unity.js',
        '--listen-port',
        String(chain.unityPort),
        '--scenario',
        EVAL_SCENARIO,
      ],
      readyPattern: /MOCK_UNITY_READY/,
      readyTimeoutMs: 10_000,
    })

    await harness.start({
      command: process.execPath,
      args: [
        'vendor/open-stage-control/app',
        '-n',
        '--no-qrcode',
        '-p',
        String(chain.httpPort),
        '-o',
        String(chain.surfacePort),
        '-l',
        'layouts/main.json',
        '-c',
        'packages/custom-module/dist/osc-surface.js',
      ],
      env: { OSC_SURFACE_CONFIG: configPath },
      readyPattern: /Server started, app available at/,
      readyTimeoutMs: 30_000,
    })

    uiClient = await createOscTestClient({ port: chain.uiPort })

    return chain
  }

  async function announce(chain: Chain): Promise<void> {
    await uiClient!.send('127.0.0.1', chain.surfacePort, SURFACE.HELLO, [
      { type: 'i', value: chain.uiPort },
    ])
  }

  test('announced UI peer reaches Unity and receives the echo back', async () => {
    const chain = await startChain(true)

    await announce(chain)

    const response = await uiClient!.request({
      to: { host: '127.0.0.1', port: chain.surfacePort },
      message: {
        address: LIGHT_ADDRESS,
        args: [{ type: 'f', value: 200 }],
      },
      expectAddress: LIGHT_ADDRESS,
      timeoutMs: 3_000,
      retries: 3,
    })

    expect(response.args).toHaveLength(1)
    expect(response.args[0]).toMatchObject({ type: 'f', value: 200 })
  }, 60_000)

  test('a peer that never announced itself receives nothing', async () => {
    const chain = await startChain(true)

    await expect(
      uiClient!.request({
        to: { host: '127.0.0.1', port: chain.surfacePort },
        message: {
          address: LIGHT_ADDRESS,
          args: [{ type: 'f', value: 200 }],
        },
        expectAddress: LIGHT_ADDRESS,
        timeoutMs: 1_500,
      }),
    ).rejects.toThrow(/Timed out waiting for OSC response/)
  }, 60_000)

  test('announcing has no effect while oscUi is disabled', async () => {
    const chain = await startChain(false)

    await announce(chain)

    await expect(
      uiClient!.request({
        to: { host: '127.0.0.1', port: chain.surfacePort },
        message: {
          address: LIGHT_ADDRESS,
          args: [{ type: 'f', value: 200 }],
        },
        expectAddress: LIGHT_ADDRESS,
        timeoutMs: 1_500,
      }),
    ).rejects.toThrow(/Timed out waiting for OSC response/)
  }, 60_000)
})
