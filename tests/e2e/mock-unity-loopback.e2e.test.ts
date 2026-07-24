import fs from 'node:fs/promises'
import dgram from 'node:dgram'
import os from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, describe, expect, test } from 'vitest'

import { SURFACE, SYS, StatsPayloadSchema, SurfaceStatusSchema } from '../../packages/shared/src'

import { openBrowserClient } from './helpers/browser-client'
import { createOscTestClient } from './helpers/osc-client'
import { ProcessHarness } from './helpers/process'
import { createWidgetInspector } from './helpers/widget-inspector'

describe('mock-unity direct loopback', () => {
  const harness = new ProcessHarness()

  afterEach(async () => {
    await harness.stopAll()
  })

  afterAll(async () => {
    await harness.stopAll()
  })

  test('test client and mock-unity round-trip ping, echo, and stats after malformed UDP', async () => {
    const listenPort = await reserveUdpPort()

    await harness.start({
      command: process.execPath,
      args: ['packages/mock-unity/dist/mock-unity.js', '--listen-port', String(listenPort)],
      readyPattern: /MOCK_UNITY_READY/,
      readyTimeoutMs: 10_000,
    })

    const client = await createOscTestClient()

    try {
      const pong = await client.request({
        to: { host: '127.0.0.1', port: listenPort },
        message: {
          address: SYS.PING,
          args: [{ type: 'i', value: 42 }],
        },
        expectAddress: SYS.PONG,
        timeoutMs: 2_000,
      })

      expect(pong).toEqual({
        address: SYS.PONG,
        args: [{ type: 'i', value: 42 }],
      })

      const echo = await client.request({
        to: { host: '127.0.0.1', port: listenPort },
        message: {
          address: '/roundtrip/probe',
          args: [
            { type: 'i', value: 7 },
            { type: 'f', value: 1.5 },
            { type: 's', value: 'ready' },
          ],
        },
        expectAddress: '/roundtrip/probe',
        timeoutMs: 2_000,
      })

      expect(echo).toEqual({
        address: '/roundtrip/probe',
        args: [
          { type: 'i', value: 7 },
          { type: 'f', value: 1.5 },
          { type: 's', value: 'ready' },
        ],
      })

      await client.sendRaw('127.0.0.1', listenPort, Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))

      const statsResponse = await client.request({
        to: { host: '127.0.0.1', port: listenPort },
        message: {
          address: SYS.STATS_REQUEST,
          args: [],
        },
        expectAddress: SYS.STATS,
        timeoutMs: 2_000,
      })

      expect(statsResponse.args).toHaveLength(1)
      expect(statsResponse.args[0]).toMatchObject({ type: 's' })

      const stats = StatsPayloadSchema.parse(JSON.parse(statsResponse.args[0]!.value as string))

      expect(stats.parseErrors).toBeGreaterThanOrEqual(1)
      expect(stats.received).toBe(3)
      expect(Date.parse(stats.lastReceivedAt)).not.toBeNaN()
    } finally {
      await client.close()
    }
  })
})

describe('mock-unity + O-S-C full chain loopback', () => {
  const harness = new ProcessHarness()

  afterEach(async () => {
    await harness.stopAll()
  })

  afterAll(async () => {
    await harness.stopAll()
  })

  test('polls surface status until ping/pong succeeds through the custom module', async () => {
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

    const client = await createOscTestClient()

    try {
      const status = await waitForSurfaceStatus(client, 15_000)

      expect(status.lastRttMs).not.toBeNull()
      expect(status.lastRttMs).toBeGreaterThanOrEqual(0)
      expect(status.consecutiveLosses).toBe(0)
      expect(status.lastPongSeq).not.toBeNull()
      expect(status.lastPongSeq).toBeGreaterThanOrEqual(1)
    } finally {
      await client.close()
    }
  })

  test('applies the standard manifest end-to-end, round-trips dynamic values, and re-syncs after mock restart', async () => {
    const tempScenarioDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osc-surface-phase2-'))
    const restartScenarioPath = path.join(tempScenarioDir, 'restart-scenario.json')
    await writeRestartScenarioFile(restartScenarioPath)

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

    const browser = await openBrowserClient('http://127.0.0.1:7080')
    const inspector = await createWidgetInspector({ host: '127.0.0.1', port: 9001 })
    const statusClient = await createOscTestClient()
    await sleep(2_000)
    const initialMock = await startMockUnityProcess(harness, {
      scenarioPath: path.resolve('packages/mock-unity/scenarios/default.json'),
      characterName: 'Chain-Alpha',
    })

    try {
      await waitForStandardManifestApplication(inspector, initialMock.characterName, {
        greetingPresent: true,
        timeoutMs: 20_000,
      })

      const smileProps = await inspector.getProps('smile_blend')
      expect(smileProps).toMatchObject({
        id: 'smile_blend',
        address: '/avatar/blend/smile',
        range: { min: 0, max: 1 },
      })

      await expect
        .poll(async () => inspector.getValue('character_name'), {
          timeout: 20_000,
          interval: 100,
        })
        .toEqual([{ type: 's', value: initialMock.characterName }])

      await expect
        .poll(async () => {
          const args = await inspector.getValue('dyn_avatar_generated_greeting')
          return args[0]?.type === 's' && typeof args[0].value === 'string'
            ? args[0].value.includes(initialMock.characterName)
            : false
        }, {
          timeout: 20_000,
          interval: 100,
        })
        .toBe(true)

      const dynamicWaveProps = await inspector.getProps('dyn_avatar_generated_wave')
      expect(dynamicWaveProps).toMatchObject({
        id: 'dyn_avatar_generated_wave',
        address: '/avatar/generated/wave',
        type: 'button',
      })

      const dynamicGreetingProps = await inspector.getProps('dyn_avatar_generated_greeting')
      expect(dynamicGreetingProps).toMatchObject({
        id: 'dyn_avatar_generated_greeting',
        address: '/avatar/generated/greeting',
        type: 'text',
      })

      const profilePanelProps = await inspector.getProps('dyn_group_Profile_panel')
      expect(profilePanelProps).toMatchObject({
        id: 'dyn_group_Profile_panel',
        type: 'panel',
      })

      await inspector.set('smile_blend', 0.6)

      await expect
        .poll(async () => {
          const args = await inspector.getValue('smile_blend')
          return args[0]?.type === 'f' && typeof args[0].value === 'number' ? args[0].value : null
        }, {
          timeout: 10_000,
          interval: 100,
        })
        .toBeCloseTo(0.6, 5)

      await initialMock.process.stop()

      const degradedStatus = await waitForSurfaceStatus(statusClient, 20_000, (status) => status.consecutiveLosses >= 1)
      expect(degradedStatus.lastPongSeq).not.toBeNull()

      const restartedMock = await startMockUnityProcess(harness, {
        scenarioPath: restartScenarioPath,
        characterName: 'Chain-Beta',
      })

      const recoveredStatus = await waitForSurfaceStatus(
        statusClient,
        20_000,
        (status) => status.lastRttMs !== null && status.consecutiveLosses === 0 && status.lastPongSeq !== null,
      )

      expect(recoveredStatus.lastRttMs).not.toBeNull()

      await waitForStandardManifestApplication(inspector, restartedMock.characterName, {
        greetingPresent: false,
        timeoutMs: 20_000,
      })

      const recoveredSmileProps = await inspector.getProps('smile_blend')
      expect(recoveredSmileProps).toMatchObject({
        range: { min: 0, max: 1 },
      })

      await expect
        .poll(async () => inspector.getValue('character_name'), {
          timeout: 20_000,
          interval: 100,
        })
        .toEqual([{ type: 's', value: restartedMock.characterName }])

      const dynamicContainerProps = await inspector.getProps('dynamic')
      expect(hasWidget(dynamicContainerProps, 'dyn_avatar_generated_greeting')).toBe(false)
      expect(hasWidget(dynamicContainerProps, 'dyn_avatar_generated_wave')).toBe(true)

      expect(browser.consoleLogs().filter((entry) => entry.startsWith('[error]'))).toEqual([])
    } finally {
      await inspector.close()
      await browser.close()
      await statusClient.close()
      await fs.rm(tempScenarioDir, { recursive: true, force: true })
    }
  })

  test('keeps the fixed layout unchanged when mock-unity returns an invalid manifest', async () => {
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

    const browser = await openBrowserClient('http://127.0.0.1:7080')
    const inspector = await createWidgetInspector({ host: '127.0.0.1', port: 9001 })
    const statusClient = await createOscTestClient()

    await startMockUnityProcess(harness, {
      scenarioPath: path.resolve('packages/mock-unity/scenarios/invalid-manifest.json'),
    })

    try {
      const status = await waitForSurfaceStatus(statusClient, 20_000)
      expect(status.lastRttMs).not.toBeNull()
      expect(status.consecutiveLosses).toBe(0)

      await expect
        .poll(async () => inspector.getProps('smile_blend'), {
          timeout: 5_000,
          interval: 100,
        })
        .toMatchObject({
          id: 'smile_blend',
          address: '/avatar/blend/smile',
          range: { min: 0, max: 1 },
        })

      await expect
        .poll(async () => inspector.getProps('character_name'), {
          timeout: 5_000,
          interval: 100,
        })
        .toMatchObject({
          id: 'character_name',
          address: '/avatar/text/name',
        })

      const dynamicContainerProps = await inspector.getProps('dynamic')
      expect(hasWidget(dynamicContainerProps, 'dynamic_placeholder')).toBe(true)
      expect(hasWidget(dynamicContainerProps, 'dyn_avatar_generated_wave')).toBe(false)
      expect(hasWidget(dynamicContainerProps, 'dyn_avatar_generated_greeting')).toBe(false)

      expect(browser.consoleLogs().filter((entry) => entry.startsWith('[error]'))).toEqual([])
    } finally {
      await inspector.close()
      await browser.close()
      await statusClient.close()
    }
  })
})

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
      throw new Error('Expected an IPv4 UDP address while reserving a port.')
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

async function waitForSurfaceStatus(
  client: Awaited<ReturnType<typeof createOscTestClient>>,
  timeoutMs: number,
  predicate: (status: ReturnType<typeof SurfaceStatusSchema.parse>) => boolean = (status) =>
    status.lastRttMs !== null && status.consecutiveLosses === 0 && status.lastPongSeq !== null,
) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = SurfaceStatusSchema.parse({
    lastRttMs: null,
    consecutiveLosses: 0,
    lastPongSeq: null,
  })

  while (Date.now() < deadline) {
    let response

    try {
      response = await client.request({
        to: { host: '127.0.0.1', port: 9001 },
        message: {
          address: SURFACE.STATUS_REQUEST,
          args: [],
        },
        expectAddress: SURFACE.STATUS,
        timeoutMs: 500,
        retries: 1,
      })
    } catch {
      await sleep(250)
      continue
    }

    expect(response.args).toHaveLength(1)
    expect(response.args[0]).toMatchObject({ type: 's' })

    lastStatus = SurfaceStatusSchema.parse(JSON.parse(response.args[0]!.value as string))
    if (predicate(lastStatus)) {
      return lastStatus
    }

    await sleep(250)
  }

  throw new Error(`Timed out waiting for full-chain surface status after ${timeoutMs}ms: ${JSON.stringify(lastStatus)}`)
}

async function startMockUnityProcess(
  harness: ProcessHarness,
  options: { scenarioPath?: string; characterName?: string } = {},
) {
  const args = [
    'packages/mock-unity/dist/mock-unity.js',
    '--listen-port',
    '9000',
    '--reply-host',
    '127.0.0.1',
    '--reply-port',
    '9001',
  ]

  if (options.scenarioPath !== undefined) {
    args.push('--scenario', options.scenarioPath)
  }

  if (options.characterName !== undefined) {
    args.push('--character-name', options.characterName)
  }

  const managedProcess = await harness.start({
    command: process.execPath,
    args,
    readyPattern: /MOCK_UNITY_READY/,
    readyTimeoutMs: 10_000,
  })

  return {
    process: managedProcess,
    characterName: parseMockReadyInfo(managedProcess.stdoutSnapshot()).characterName,
  }
}

function parseMockReadyInfo(stdout: string): { characterName: string } {
  const readyLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('MOCK_UNITY_READY '))

  if (readyLine === undefined) {
    throw new Error(`Failed to find MOCK_UNITY_READY in mock-unity output.\n${stdout}`)
  }

  const payload = JSON.parse(readyLine.slice('MOCK_UNITY_READY '.length)) as { characterName?: unknown }
  if (typeof payload.characterName !== 'string' || payload.characterName.length === 0) {
    throw new Error(`MOCK_UNITY_READY did not include a characterName string.\n${readyLine}`)
  }

  return {
    characterName: payload.characterName,
  }
}

async function waitForStandardManifestApplication(
  inspector: Awaited<ReturnType<typeof createWidgetInspector>>,
  characterName: string,
  options: { greetingPresent: boolean; timeoutMs: number },
): Promise<void> {
  await inspector.waitForProps(
    'smile_blend',
    (props) =>
      props.address === '/avatar/blend/smile' &&
      JSON.stringify(props.range) === JSON.stringify({ min: 0, max: 1 }),
    options.timeoutMs,
  )

  await expect
    .poll(async () => inspector.getValue('character_name'), {
      timeout: options.timeoutMs,
      interval: 100,
    })
    .toEqual([{ type: 's', value: characterName }])

  await inspector.waitForProps(
    'dynamic',
    (props) =>
      hasWidget(props, 'dyn_avatar_generated_wave') &&
      hasWidget(props, 'dyn_avatar_generated_greeting') === options.greetingPresent &&
      hasWidget(props, 'dyn_group_Profile_panel') === options.greetingPresent,
    options.timeoutMs,
  )
}

function hasWidget(props: Record<string, unknown>, widgetId: string): boolean {
  return findWidgetById(props, widgetId) !== null
}

function findWidgetById(node: unknown, widgetId: string): Record<string, unknown> | null {
  if (node === null || typeof node !== 'object') {
    return null
  }

  if (!Array.isArray(node) && (node as Record<string, unknown>).id === widgetId) {
    return node as Record<string, unknown>
  }

  const children = Array.isArray(node)
    ? node
    : Array.isArray((node as Record<string, unknown>).widgets)
      ? ((node as Record<string, unknown>).widgets as unknown[])
      : []

  for (const child of children) {
    const match = findWidgetById(child, widgetId)
    if (match !== null) {
      return match
    }
  }

  return null
}

async function writeRestartScenarioFile(filePath: string): Promise<void> {
  const defaultScenarioPath = path.resolve('packages/mock-unity/scenarios/default.json')
  const parsed = JSON.parse(await fs.readFile(defaultScenarioPath, 'utf8')) as {
    characterName?: unknown
    entries?: Array<Record<string, unknown>>
    rawManifestOverride?: unknown
  }

  const entries = Array.isArray(parsed.entries)
    ? parsed.entries.filter((entry) => entry.address !== '/avatar/generated/greeting')
    : []

  const nextScenario = {
    characterName: parsed.characterName,
    entries,
  }

  await fs.writeFile(filePath, `${JSON.stringify(nextScenario, null, 2)}\n`, 'utf8')
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}
