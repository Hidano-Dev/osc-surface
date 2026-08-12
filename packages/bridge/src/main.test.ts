import { describe, expect, it } from 'vitest'

import { composeBridgeConfig } from './main'
import { parseCliArgs } from './cli'
import type { BridgeConfig } from './surface-core'

const CONFIG: BridgeConfig = {
  unity: { host: 'unity.example.test', sendPort: 7000 },
  bridge: { oscListenHost: '0.0.0.0', oscListenPort: 7001, wsHost: '0.0.0.0', wsPort: 7002 },
  ui: { host: '0.0.0.0', port: 7003 },
  debug: false,
  boolFallbackToInt: false,
  diagnostics: {
    ringBufferSize: 200,
    lossRateWindow: 30,
    ndjsonDir: 'logs/diagnostics',
    ndjsonMaxTotalBytes: 52_428_800,
  },
  oscUi: { enabled: false, staticPeers: [], peerTtlMs: 0 },
}

describe('composeBridgeConfig', () => {
  it('applies CLI overrides over file values while retaining config ports by default', () => {
    expect(composeBridgeConfig(CONFIG, parseCliArgs([]))).toEqual(CONFIG)
    expect(composeBridgeConfig(CONFIG, parseCliArgs([
      '--unity-host', '127.0.0.1', '--unity-port', '7100',
      '--osc-listen-port', '7101', '--ws-port', '7102', '--ui-port', '7103', '--debug',
    ]))).toMatchObject({
      unity: { host: '127.0.0.1', sendPort: 7100 },
      bridge: { oscListenPort: 7101, wsPort: 7102 },
      ui: { port: 7103 },
      debug: true,
    })
  })
})
