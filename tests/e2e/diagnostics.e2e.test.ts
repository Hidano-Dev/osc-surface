import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import dgram from 'node:dgram'

import { afterAll, afterEach, describe, expect, test } from 'vitest'

import {
  DiagnosticsSnapshotSchema,
  SYS,
  SURFACE_DIAG,
  type DiagnosticsSnapshot,
  type SurfaceConfig,
} from '../../packages/shared/src'

import { openBrowserClient } from './helpers/browser-client'
import { createOscTestClient } from './helpers/osc-client'
import { ProcessHarness } from './helpers/process'
import { createWidgetInspector } from './helpers/widget-inspector'

interface LoopbackPorts {
  httpPort: number
  oscPort: number
  unityPort: number
}

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

  test('debug ON publishes diagnostics snapshot and NDJSON logs', async () => {
    const ports = await allocateLoopbackPorts()
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osc-surface-diag-on-'))
    const logDir = path.join(tempDir, 'logs')
    const configPath = path.join(tempDir, 'surface.debug.config.json')

    await writeSurfaceConfig(
      configPath,
      createSurfaceConfig({
        debug: true,
        logDir,
        ports,
      }),
    )

    process.env.OSC_SURFACE_CONFIG = configPath

    await startMockUnity(harness, ports)
    await startOscSurface(harness, ports)

    const browser = await openBrowserClient(`http://127.0.0.1:${ports.httpPort}`)
    const inspector = await createWidgetInspector({ host: '127.0.0.1', port: ports.oscPort })
    const oscClient = await createOscTestClient()

    try {
      const snapshot = await waitForDiagnosticsSnapshot(oscClient, ports.oscPort, 15_000)

      expect(snapshot.reachability).toBe('reachable')
      expect(snapshot.lastRttMs).not.toBeNull()
      expect(snapshot.lastRttMs).toBeGreaterThanOrEqual(0)
      expect(snapshot.consecutiveLosses).toBe(0)
      expect(snapshot.lossRate.observed).toBeGreaterThan(0)
      expect(snapshot.lossRate.lost).toBe(0)
      expect(snapshot.lossRate.rate).toBe(0)
      expect(snapshot.subnet.kind).toBe('sameHost')
      expect(snapshot.recentMessages.some((message) => message.address === SYS.PING)).toBe(true)
      expect(snapshot.recentMessages.some((message) => message.address === SYS.PONG)).toBe(true)

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
          args[0].value.includes(SYS.PING) &&
          args[0].value.includes(SYS.PONG),
        )

      const files = await waitForNdjsonFiles(logDir, 10_000)
      expect(files.length).toBeGreaterThan(0)

      const logContents = await fs.readFile(path.join(logDir, files[0]!), 'utf8')
      const logRecords = logContents
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { address?: unknown })

      expect(logRecords.some((record) => record.address === SYS.PING)).toBe(true)
      expect(logRecords.some((record) => record.address === SYS.PONG)).toBe(true)
    } finally {
      await browser.close()
      await inspector.close()
      await oscClient.close()
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('debug OFF ignores diagnostics requests and does not create NDJSON logs', async () => {
    const ports = await allocateLoopbackPorts()
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osc-surface-diag-off-'))
    const logDir = path.join(tempDir, 'logs')
    const configPath = path.join(tempDir, 'surface.config.json')

    await writeSurfaceConfig(
      configPath,
      createSurfaceConfig({
        debug: false,
        logDir,
        ports,
      }),
    )

    process.env.OSC_SURFACE_CONFIG = configPath

    await startMockUnity(harness, ports)
    await startOscSurface(harness, ports)

    const oscClient = await createOscTestClient()

    try {
      await expect(
        oscClient.request({
          to: { host: '127.0.0.1', port: ports.oscPort },
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

  test('drop-pong fault drives diagnostics reachability to lost', async () => {
    const ports = await allocateLoopbackPorts()
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osc-surface-diag-drop-pong-'))
    const configPath = path.join(tempDir, 'surface.debug.config.json')

    await writeSurfaceConfig(
      configPath,
      createSurfaceConfig({
        debug: true,
        logDir: path.join(tempDir, 'logs'),
        ports,
      }),
    )

    process.env.OSC_SURFACE_CONFIG = configPath

    await startMockUnity(harness, ports, { fault: 'drop-pong' })
    await startOscSurface(harness, ports)

    const oscClient = await createOscTestClient()

    try {
      const snapshot = await waitForDiagnosticsSnapshotWhere(
        oscClient,
        ports.oscPort,
        12_000,
        (candidate) =>
          candidate.reachability === 'lost' &&
          candidate.consecutiveLosses >= 1 &&
          candidate.lastRttMs === null &&
          candidate.lossRate.observed >= 1 &&
          candidate.lossRate.lost >= 1 &&
          candidate.recentMessages.some((message) => message.address === SYS.PING) &&
          !candidate.recentMessages.some((message) => message.address === SYS.PONG),
        'drop-pong diagnostics state',
      )

      expect(snapshot.lossRate.rate).toBe(1)
    } finally {
      await oscClient.close()
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('silent fault keeps diagnostics inbound empty and moves reachability to lost', async () => {
    const ports = await allocateLoopbackPorts()
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osc-surface-diag-silent-'))
    const configPath = path.join(tempDir, 'surface.debug.config.json')

    await writeSurfaceConfig(
      configPath,
      createSurfaceConfig({
        debug: true,
        logDir: path.join(tempDir, 'logs'),
        ports,
      }),
    )

    process.env.OSC_SURFACE_CONFIG = configPath

    await startMockUnity(harness, ports, { fault: 'silent' })
    await startOscSurface(harness, ports)

    const oscClient = await createOscTestClient()

    try {
      const snapshot = await waitForDiagnosticsSnapshotWhere(
        oscClient,
        ports.oscPort,
        12_000,
        (candidate) =>
          candidate.reachability === 'lost' &&
          candidate.consecutiveLosses >= 1 &&
          candidate.lastRttMs === null &&
          candidate.lossRate.observed >= 1 &&
          candidate.lossRate.lost >= 1 &&
          candidate.recentMessages.length > 0 &&
          candidate.recentMessages.every((message) => message.dir === 'out'),
        'silent diagnostics state',
      )

      expect(snapshot.lossRate.rate).toBe(1)
      expect(snapshot.recentMessages.some((message) => message.address === SYS.PONG)).toBe(false)
    } finally {
      await oscClient.close()
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('random-loss fault reports a partial loss rate', async () => {
    const ports = await allocateLoopbackPorts()
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osc-surface-diag-random-loss-'))
    const configPath = path.join(tempDir, 'surface.debug.config.json')

    await writeSurfaceConfig(
      configPath,
      createSurfaceConfig({
        debug: true,
        logDir: path.join(tempDir, 'logs'),
        ports,
      }),
    )

    process.env.OSC_SURFACE_CONFIG = configPath

    await startMockUnity(harness, ports, { fault: 'random-loss:0.5' })
    await startOscSurface(harness, ports)

    const oscClient = await createOscTestClient()

    try {
      const snapshot = await waitForDiagnosticsSnapshotWhere(
        oscClient,
        ports.oscPort,
        18_000,
        (candidate) =>
          candidate.lossRate.observed >= 3 &&
          candidate.lossRate.rate !== null &&
          candidate.lossRate.rate > 0 &&
          candidate.lossRate.rate < 1 &&
          candidate.lossRate.lost > 0 &&
          candidate.lossRate.lost < candidate.lossRate.observed &&
          candidate.lastRttMs !== null &&
          candidate.recentMessages.some((message) => message.address === SYS.PING) &&
          candidate.recentMessages.some((message) => message.address === SYS.PONG),
        'random-loss diagnostics state',
      )

      expect(snapshot.lossRate.rate).toBeGreaterThan(0)
      expect(snapshot.lossRate.rate).toBeLessThan(1)
    } finally {
      await oscClient.close()
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('delay fault surfaces RTT at or above the injected latency', async () => {
    const ports = await allocateLoopbackPorts()
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osc-surface-diag-delay-'))
    const configPath = path.join(tempDir, 'surface.debug.config.json')

    await writeSurfaceConfig(
      configPath,
      createSurfaceConfig({
        debug: true,
        logDir: path.join(tempDir, 'logs'),
        ports,
      }),
    )

    process.env.OSC_SURFACE_CONFIG = configPath

    await startMockUnity(harness, ports, { fault: 'delay:150' })
    await startOscSurface(harness, ports)

    const oscClient = await createOscTestClient()

    try {
      const snapshot = await waitForDiagnosticsSnapshotWhere(
        oscClient,
        ports.oscPort,
        12_000,
        (candidate) =>
          candidate.reachability === 'reachable' &&
          candidate.lastRttMs !== null &&
          candidate.lastRttMs >= 150 &&
          candidate.lossRate.lost === 0 &&
          candidate.recentMessages.some((message) => message.address === SYS.PONG),
        'delay diagnostics state',
      )

      expect(snapshot.lastRttMs).toBeGreaterThanOrEqual(150)
    } finally {
      await oscClient.close()
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  test('corrupt fault is ignored by diagnostics and does not produce inbound pong logs', async () => {
    const ports = await allocateLoopbackPorts()
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osc-surface-diag-corrupt-'))
    const logDir = path.join(tempDir, 'logs')
    const configPath = path.join(tempDir, 'surface.debug.config.json')

    await writeSurfaceConfig(
      configPath,
      createSurfaceConfig({
        debug: true,
        logDir,
        ports,
      }),
    )

    process.env.OSC_SURFACE_CONFIG = configPath

    await startMockUnity(harness, ports, { fault: 'corrupt' })
    await startOscSurface(harness, ports)

    const oscClient = await createOscTestClient()

    try {
      const snapshot = await waitForDiagnosticsSnapshotWhere(
        oscClient,
        ports.oscPort,
        12_000,
        (candidate) =>
          candidate.reachability === 'lost' &&
          candidate.consecutiveLosses >= 1 &&
          candidate.lastRttMs === null &&
          candidate.recentMessages.some((message) => message.address === SYS.PING) &&
          !candidate.recentMessages.some((message) => message.address === SYS.PONG),
        'corrupt diagnostics state',
      )

      const files = await waitForNdjsonFiles(logDir, 10_000)
      const logContents = await fs.readFile(path.join(logDir, files[0]!), 'utf8')

      expect(snapshot.lossRate.lost).toBeGreaterThanOrEqual(1)
      expect(logContents.includes(SYS.PING)).toBe(true)
      expect(logContents.includes(SYS.PONG)).toBe(false)
    } finally {
      await oscClient.close()
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})

function createSurfaceConfig(options: {
  debug: boolean
  logDir: string
  ports: LoopbackPorts
}): SurfaceConfig {
  return {
    unity: {
      host: '127.0.0.1',
      sendPort: options.ports.unityPort,
      receivePort: options.ports.oscPort,
    },
    debug: options.debug,
    boolFallbackToInt: false,
    diagnostics: {
      ringBufferSize: 200,
      lossRateWindow: 30,
      ndjsonDir: options.logDir,
      ndjsonMaxTotalBytes: 52_428_800,
    },
  }
}

async function startMockUnity(
  harness: ProcessHarness,
  ports: LoopbackPorts,
  options?: {
    fault?: string
  },
): Promise<void> {
  const args = [
    'packages/mock-unity/dist/mock-unity.js',
    '--listen-port',
    String(ports.unityPort),
    '--reply-host',
    '127.0.0.1',
    '--reply-port',
    String(ports.oscPort),
  ]

  if (options?.fault !== undefined) {
    args.push('--fault', options.fault)
  }

  await harness.start({
    command: process.execPath,
    args,
    readyPattern: /MOCK_UNITY_READY/,
    readyTimeoutMs: 10_000,
  })
}

async function startOscSurface(harness: ProcessHarness, ports: LoopbackPorts): Promise<void> {
  await harness.start({
    command: process.execPath,
    args: [
      'vendor/open-stage-control/app',
      '-n',
      '-p',
      String(ports.httpPort),
      '-o',
      String(ports.oscPort),
      '-s',
      `127.0.0.1:${ports.unityPort}`,
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
  oscPort: number,
  timeoutMs: number,
): Promise<DiagnosticsSnapshot> {
  return waitForDiagnosticsSnapshotWhere(
    client,
    oscPort,
    timeoutMs,
    (snapshot) =>
      snapshot.reachability === 'reachable' &&
      snapshot.lastRttMs !== null &&
      snapshot.lossRate.observed > 0 &&
      snapshot.subnet.kind === 'sameHost',
    'ready diagnostics snapshot',
  )
}

async function waitForDiagnosticsSnapshotWhere(
  client: Awaited<ReturnType<typeof createOscTestClient>>,
  oscPort: number,
  timeoutMs: number,
  predicate: (snapshot: DiagnosticsSnapshot) => boolean,
  description: string,
): Promise<DiagnosticsSnapshot> {
  const deadline = Date.now() + timeoutMs
  let lastSnapshot: DiagnosticsSnapshot | null = null

  while (Date.now() < deadline) {
    try {
      lastSnapshot = await requestDiagnosticsSnapshot(client, oscPort)
      if (predicate(lastSnapshot)) {
        return lastSnapshot
      }
    } catch {
      // Keep polling until the diagnostics state is fully populated.
    }

    await sleep(250)
  }

  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms: ${JSON.stringify(lastSnapshot)}`)
}

async function requestDiagnosticsSnapshot(
  client: Awaited<ReturnType<typeof createOscTestClient>>,
  oscPort: number,
): Promise<DiagnosticsSnapshot> {
  const response = await client.request({
    to: { host: '127.0.0.1', port: oscPort },
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

  return DiagnosticsSnapshotSchema.parse(JSON.parse(payload.value))
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

async function allocateLoopbackPorts(): Promise<LoopbackPorts> {
  return {
    httpPort: await reserveTcpPort(),
    oscPort: await reserveUdpPort(),
    unityPort: await reserveUdpPort(),
  }
}

async function reserveTcpPort(): Promise<number> {
  const server = net.createServer()

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })

    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a TCP port while reserving the diagnostics HTTP port.')
    }

    return address.port
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}

async function reserveUdpPort(): Promise<number> {
  const socket = dgram.createSocket('udp4')

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(0, '127.0.0.1', () => {
        socket.off('error', reject)
        resolve()
      })
    })

    const address = socket.address()
    if (typeof address === 'string') {
      throw new Error('Expected a UDP port while reserving diagnostics ports.')
    }

    return address.port
  } finally {
    await new Promise<void>((resolve, reject) => {
      socket.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}
