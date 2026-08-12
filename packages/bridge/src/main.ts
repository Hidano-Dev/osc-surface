import { DEFAULT_SURFACE_CONFIG_PATH, formatConfigLoadError, loadSurfaceConfig } from './config'
import { DEFAULT_UI_PORT, DEFAULT_WS_PORT, parseCliArgs } from './cli'
import { startBridgeServer } from './bridge-server'
import type { BridgeConfig } from './surface-core'

export interface BridgeReadyLine {
  wsPort: number
  oscListenPort: number
  unity: { host: string; sendPort: number }
  uiPort: number
  protocolVersion: number
  debug: boolean
  configPath: string
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  let cli
  try {
    cli = parseCliArgs(argv)
  } catch (error) {
    throw new BridgeMainError(error instanceof Error ? error.message : String(error), 2)
  }
  const configPath = cli.configPath || DEFAULT_SURFACE_CONFIG_PATH
  const loaded = loadSurfaceConfig({ path: configPath })
  if (!loaded.ok) throw new BridgeMainError(formatConfigLoadError(loaded.error), 2)
  const config: BridgeConfig = {
    ...loaded.value,
    unity: {
      ...loaded.value.unity,
      ...(cli.unityHost === undefined ? {} : { host: cli.unityHost }),
      ...(cli.unityPort === undefined ? {} : { sendPort: cli.unityPort }),
    },
    debug: cli.debug ?? loaded.value.debug,
    bridge: { oscListenPort: cli.oscListenPort ?? loaded.value.unity.receivePort, wsPort: cli.wsPort ?? DEFAULT_WS_PORT },
  }
  const server = await startBridgeServer({ config })
  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    await server.close()
  }
  const onSignal = () => void shutdown().then(() => process.exit(0), () => process.exit(1))
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const ready: BridgeReadyLine = {
    wsPort: server.wsPort,
    oscListenPort: server.oscListenPort,
    unity: { host: config.unity.host, sendPort: config.unity.sendPort },
    uiPort: cli.uiPort || DEFAULT_UI_PORT,
    protocolVersion: 1,
    debug: config.debug,
    configPath,
  }
  process.stdout.write(`OSCDESK_BRIDGE_READY ${JSON.stringify(ready)}\n`)
}

export class BridgeMainError extends Error {
  constructor(message: string, readonly exitCode: 1 | 2 | 3) { super(message) }
}

export function exitCodeFor(error: unknown): 1 | 2 | 3 {
  if (error instanceof BridgeMainError) return error.exitCode
  if (isPortBindError(error)) return 3
  return 1
}

function isPortBindError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && ['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL'].includes(String((error as { code?: unknown }).code))
}
