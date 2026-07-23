import { afterEach, describe, expect, test } from 'vitest'

import { ProcessHarness } from './helpers/process'

describe('ProcessHarness', () => {
  const harness = new ProcessHarness()

  afterEach(async () => {
    await harness.stopAll()
  })

  test('ready patternを待機してstopAllで終了できる', async () => {
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

  test('ready timeout時は出力を添えて失敗する', async () => {
    await expect(
      harness.start({
        command: process.execPath,
        args: ['-e', "process.stdout.write('still booting\\n'); setInterval(() => {}, 1000)"],
        readyPattern: /READY/,
        readyTimeoutMs: 100,
      }),
    ).rejects.toThrow(/Captured output:\n\[stdout\] still booting/)
  })
})
