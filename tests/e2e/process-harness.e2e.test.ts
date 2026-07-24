import { afterEach, describe, expect, test } from 'vitest'

import { ProcessHarness } from './helpers/process'

describe('ProcessHarness', () => {
  const harness = new ProcessHarness()

  afterEach(async () => {
    await harness.stopAll()
  })

  test('ready patternを検出して stopAll で終了できる', async () => {
    const managed = await harness.start({
      command: process.execPath,
      args: [
        '-e',
        [
          "process.stdout.write('BOOTING\\n')",
          "setTimeout(() => process.stdout.write('READY\\n'), 20)",
          'setInterval(() => {}, 1000)',
        ].join(';'),
      ],
      readyPattern: /READY/,
      readyTimeoutMs: 5_000,
    })

    expect(managed.pid).toBeGreaterThan(0)
    expect(managed.stdoutSnapshot()).toContain('READY')

    await harness.stopAll()
  })

  test('ready timeout 時に起動失敗として扱う', async () => {
    await expect(
      harness.start({
        command: process.execPath,
        args: ['-e', "process.stdout.write('still booting\\n'); setInterval(() => {}, 1000)"],
        readyPattern: /READY/,
        readyTimeoutMs: 100,
      }),
    ).rejects.toThrow(/Captured output:\n\[stdout\] still booting/)
  })

  test('環境変数オーバーライドを子プロセスへ渡せる', async () => {
    const managed = await harness.start({
      command: process.execPath,
      args: ['-e', "process.stdout.write(`READY:${process.env.TEST_READY_VALUE ?? 'missing'}\\n`); setInterval(() => {}, 1000)"],
      env: {
        TEST_READY_VALUE: 'from-harness',
      },
      readyPattern: /READY:from-harness/,
      readyTimeoutMs: 5_000,
    })

    expect(managed.stdoutSnapshot()).toContain('READY:from-harness')
  })
})
