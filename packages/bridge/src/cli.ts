import path from 'node:path'

export interface BridgeCliOptions {
  configPath: string
  wsPort?: number
  oscListenPort?: number
  unityHost?: string
  unityPort?: number
  uiPort: number
  debug?: boolean
}

export const DEFAULT_WS_PORT = 7080
export const DEFAULT_UI_PORT = 8080

export function parseCliArgs(argv: readonly string[]): BridgeCliOptions {
  let configPath: string | undefined
  let wsPort: number | undefined
  let oscListenPort: number | undefined
  let unityHost: string | undefined
  let unityPort: number | undefined
  let uiPort = DEFAULT_UI_PORT
  let debug: boolean | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    switch (flag) {
      case '--config': configPath = path.resolve(readValue(flag, argv, ++index)); break
      case '--ws-port': wsPort = parsePort(flag, readValue(flag, argv, ++index)); break
      case '--osc-listen-port': oscListenPort = parsePort(flag, readValue(flag, argv, ++index)); break
      case '--unity-host': unityHost = readValue(flag, argv, ++index); break
      case '--unity-port': unityPort = parsePort(flag, readValue(flag, argv, ++index)); break
      case '--ui-port': uiPort = parsePort(flag, readValue(flag, argv, ++index)); break
      case '--debug': debug = true; break
      default: throw new Error(`Unknown argument: ${flag}`)
    }
  }

  return { configPath: configPath ?? '', wsPort, oscListenPort, unityHost, unityPort, uiPort, debug }
}

function readValue(flag: string, argv: readonly string[], index: number): string {
  const value = argv[index]
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
  return value
}

function parsePort(flag: string, raw: string): number {
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port for ${flag}: ${raw}`)
  return port
}
