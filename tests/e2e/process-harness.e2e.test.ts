import { afterEach, describe, expect, test } from 'vitest'

import { ProcessHarness } from './helpers/process'

describe('ProcessHarness', () => {
  const harness = new ProcessHarness()

  afterEach(async () => {
    await harness.stopAll()
  })

  test('ブリッジのREADY行を検出して stopAll で終了できる', async () => {
    const managed = await harness.start({
      command: process.execPath,
      args: [
        '-e',
        [
          "process.stdout.write('BOOTING\\n')",
          "setTimeout(() => process.stdout.write('OSCDESK_BRIDGE_READY {\\\"wsPort\\\":7080}\\n'), 20)",
          'setInterval(() => {}, 1000)',
        ].join(';'),
      ],
      readyPattern: /^OSCDESK_BRIDGE_READY /m,
      readyTimeoutMs: 5_000,
    })

    expect(managed.pid).toBeGreaterThan(0)
    expect(managed.stdoutSnapshot()).toMatch(/^OSCDESK_BRIDGE_READY /m)

    await harness.stopAll()
  })

  test('ブリッジREADY行の待機タイムアウトを起動失敗として扱う', async () => {
    await expect(
      harness.start({
        command: process.execPath,
        args: ['-e', "process.stdout.write('still booting\\n'); setInterval(() => {}, 1000)"],
        readyPattern: /^OSCDESK_BRIDGE_READY /m,
        readyTimeoutMs: 100,
      }),
    ).rejects.toThrow(/Captured output:\n\[stdout\] still booting/)
  })

  test('mock-unityのREADY行と環境変数を子プロセスへ渡せる', async () => {
    const managed = await harness.start({
      command: process.execPath,
      args: ['-e', "process.stdout.write(`MOCK_UNITY_READY ${process.env.TEST_READY_VALUE ?? 'missing'}\\n`); setInterval(() => {}, 1000)"],
      env: {
        TEST_READY_VALUE: 'from-harness',
      },
      readyPattern: /^MOCK_UNITY_READY from-harness$/m,
      readyTimeoutMs: 5_000,
    })

    expect(managed.stdoutSnapshot()).toMatch(/^MOCK_UNITY_READY from-harness$/m)
  })
})
