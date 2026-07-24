import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, describe, expect, test } from 'vitest'

import {
  DiagnosticsSnapshotSchema,
  SURFACE_DIAG,
  type DiagnosticsSnapshot,
  type SurfaceConfig,
} from '../../packages/shared/src'

import { openBrowserClient } from './helpers/browser-client'
import { createOscTestClient } from './helpers/osc-client'
import { ProcessHarness } from './helpers/process'
import { createWidgetInspector } from './helpers/widget-inspector'

describe('diagnostics E2E', () => {
  const harness = new ProcessHarness()
  const originalSurfaceConfigEnv = process.env.OSC_SURFACE_CONFIG

  afterEach(async () => {
    process.env.OSC_SURFACE_CONFIG = originalSurfaceConfigEnv
    await harness.stopAll()
  })

  afterAll(async () => {
    process.env.OSC_SURFACE_CONFIG = originalSurfaceConfigEnv
    await harness.stopAll()
  })

  test('debug ON で正常系のスナップショットと NDJSON を確認できる', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osc-surface-diag-on-'))
    const logDir = path.join(tempDir, 'logs')
    const configPath = path.join(tempDir, 'surface.debug.config.json')

    await writeSurfaceConfig(configPath, {
      unity: {
        host: '127.0.0.1',
        sendPort: 9000,
        receivePort: 9001,
      },
      debug: true,
      boolFallbackToInt: false,
      diagnostics: {
        ringBufferSize: 200,
        lossRateWindow: 30,
        ndjsonDir: logDir,
        ndjsonMaxTotalBytes: 52_428_800,
      },
    })

    process.env.OSC_SURFACE_CONFIG = configPath

    await startMockUnity(harness)
    await startOscSurface(harness)

    const browser = await openBrowserClient('http://127.0.0.1:7080')
    const inspector = await createWidgetInspector({ host: '127.0.0.1', port: 9001 })
    const oscClient = await createOscTestClient()

    try {
      const snapshot = await waitForDiagnosticsSnapshot(oscClient, 15_000)

      expect(snapshot.reachability).toBe('reachable')
      expect(snapshot.lastRttMs).not.toBeNull()
      expect(snapshot.lastRttMs).toBeGreaterThanOrEqual(0)
      expect(snapshot.consecutiveLosses).toBe(0)
      expect(snapshot.lossRate.observed).toBeGreaterThan(0)
      expect(snapshot.lossRate.lost).toBe(0)
      expect(snapshot.lossRate.rate).toBe(0)
      expect(snapshot.subnet.kind).toBe('sameHost')
      expect(snapshot.recentMessages.some((message) => message.address === '/sys/ping')).toBe(true)
      expect(snapshot.recentMessages.some((message) => message.address === '/sys/pong')).toBe(true)

      await expect
        .poll(async () => inspector.getValue('diag_rtt'), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([{ type: 's', value: String(snapshot.lastRttMs) }])

      await expect
        .poll(async () => inspector.getValue('diag_loss_rate'), {
          timeout: 5_000,
          interval: 100,
        })
        .toEqual([{ type: 's', value: `${snapshot.lossRate.rate * 100}% (0/${snapshot.lossRate.observed})` }])

      await expect
        .poll(async () => inspector.getValue('diag_messages'), {
          timeout: 5_000,
          interval: 100,
        })
        .toSatisfy((args) =>
          Array.isArray(args) &&
          args[0]?.type === 's' &&
          typeof args[0].value === 'string' &&
          args[0].value.includes('/sys/ping') &&
          args[0].value.includes('/sys/pong'),
        )

      const files = await waitForNdjsonFiles(logDir, 10_000)
      expect(files.length).toBeGreaterThan(0)

      const logContents = await fs.readFile(path.join(logDir, files[0]!), 'utf8')
      const logRecords = logContents
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { address?: unknown })

      expect(logRecords.some((record) => record.address === '/sys/ping')).toBe(true)
      expect(logRecords.some((record) => record.address === '/sys/pong')).toBe(true)
    } finally {
      await browser.close()
      await inspector.close()
      await oscClient.close()
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('debug OFF では diagnostics request に応答せず NDJSON も生成しない', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osc-surface-diag-off-'))
    const logDir = path.join(tempDir, 'logs')
    const configPath = path.join(tempDir, 'surface.config.json')

    await writeSurfaceConfig(configPath, {
      unity: {
        host: '127.0.0.1',
        sendPort: 9000,
        receivePort: 9001,
      },
      debug: false,
      boolFallbackToInt: false,
      diagnostics: {
        ringBufferSize: 200,
        lossRateWindow: 30,
        ndjsonDir: logDir,
        ndjsonMaxTotalBytes: 52_428_800,
      },
    })

    process.env.OSC_SURFACE_CONFIG = configPath

    await startMockUnity(harness)
    await startOscSurface(harness)

    const oscClient = await createOscTestClient()

    try {
      await expect(
        oscClient.request({
          to: { host: '127.0.0.1', port: 9001 },
          message: {
            address: SURFACE_DIAG.REQUEST,
            args: [],
          },
          expectAddress: SURFACE_DIAG.SNAPSHOT,
          timeoutMs: 500,
          retries: 0,
        }),
      ).rejects.toThrow(/Timed out waiting for OSC response/)

      await sleep(1_500)

      await expect(fs.access(logDir)).rejects.toThrow()
    } finally {
      await oscClient.close()
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})

async function startMockUnity(harness: ProcessHarness): Promise<void> {
  await harness.start({
    command: process.execPath,
    args: [
      'packages/mock-unity/dist/mock-unity.js',
      '--listen-port',
      '9000',
      '--reply-host',
      '127.0.0.1',
      '--reply-port',
      '9001',
    ],
    readyPattern: /MOCK_UNITY_READY/,
    readyTimeoutMs: 10_000,
  })
}

async function startOscSurface(harness: ProcessHarness): Promise<void> {
  await harness.start({
    command: process.execPath,
    args: [
      'vendor/open-stage-control/app',
      '-n',
      '-p',
      '7080',
      '-o',
      '9001',
      '-s',
      '127.0.0.1:9000',
      '-l',
      'layouts/main.json',
      '-c',
      'packages/custom-module/dist/osc-surface.js',
    ],
    readyPattern: /Server started, app available at/,
    readyTimeoutMs: 30_000,
  })
}

async function waitForDiagnosticsSnapshot(
  client: Awaited<ReturnType<typeof createOscTestClient>>,
  timeoutMs: number,
): Promise<DiagnosticsSnapshot> {
  const deadline = Date.now() + timeoutMs
  let lastSnapshot: DiagnosticsSnapshot | null = null

  while (Date.now() < deadline) {
    try {
      const response = await client.request({
        to: { host: '127.0.0.1', port: 9001 },
        message: {
          address: SURFACE_DIAG.REQUEST,
          args: [],
        },
        expectAddress: SURFACE_DIAG.SNAPSHOT,
        timeoutMs: 1_000,
        retries: 1,
      })

      const payload = response.args[0]
      if (payload?.type !== 's' || typeof payload.value !== 'string') {
        throw new Error('Diagnostics snapshot response must contain a JSON string payload.')
      }

      lastSnapshot = DiagnosticsSnapshotSchema.parse(JSON.parse(payload.value))
      if (
        lastSnapshot.reachability === 'reachable' &&
        lastSnapshot.lastRttMs !== null &&
        lastSnapshot.lossRate.observed > 0 &&
        lastSnapshot.subnet.kind === 'sameHost'
      ) {
        return lastSnapshot
      }
    } catch {
      // Keep polling until the diagnostics state is fully populated.
    }

    await sleep(250)
  }

  throw new Error(
    `Timed out waiting for diagnostics snapshot after ${timeoutMs}ms: ${JSON.stringify(lastSnapshot)}`,
  )
}

async function waitForNdjsonFiles(logDir: string, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const files = (await fs.readdir(logDir)).filter((name) => name.endsWith('.ndjson'))
      if (files.length > 0) {
        return files
      }
    } catch {
      // The directory is created lazily only in debug mode.
    }

    await sleep(250)
  }

  throw new Error(`Timed out waiting for NDJSON files in "${logDir}" after ${timeoutMs}ms.`)
}

async function writeSurfaceConfig(filePath: string, config: SurfaceConfig): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}
