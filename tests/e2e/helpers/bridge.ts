import path from 'node:path'

import { ProcessHarness, type ManagedProcess } from './process'

export interface BridgeReadyLine {
  wsPort: number
  oscListenPort: number
  unity: { host: string; sendPort: number }
  uiPort: number
  protocolVersion: number
  debug: boolean
  configPath: string
}

export interface BridgeProcess extends ManagedProcess {
  readonly ready: BridgeReadyLine
}

export interface StartBridgeOptions {
  configPath?: string
  wsPort?: number
  oscListenPort?: number
  unityHost?: string
  unityPort?: number
  uiPort?: number
  debug?: boolean
  readyTimeoutMs?: number
}

const DEFAULT_READY_TIMEOUT_MS = 30_000

export async function startBridge(options: StartBridgeOptions = {}): Promise<BridgeProcess> {
  const args = [path.resolve('packages/bridge/dist/oscdesk-bridge.js')]
  appendOption(args, '--config', options.configPath)
  appendOption(args, '--ws-port', options.wsPort)
  appendOption(args, '--osc-listen-port', options.oscListenPort)
  appendOption(args, '--unity-host', options.unityHost)
  appendOption(args, '--unity-port', options.unityPort)
  appendOption(args, '--ui-port', options.uiPort)
  if (options.debug === true) args.push('--debug')

  const harness = new ProcessHarness()
  const managed = await harness.start({
    command: process.execPath,
    args,
    readyPattern: /^OSCDESK_BRIDGE_READY /m,
    readyTimeoutMs: options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
  })

  try {
    const ready = parseReadyLine(managed.stdoutSnapshot())
    return {
      pid: managed.pid,
      ready,
      stdoutSnapshot: () => managed.stdoutSnapshot(),
      stop: async () => {
        await managed.stop()
        await harness.stopAll()
      },
    }
  } catch (error) {
    await harness.stopAll().catch(() => undefined)
    throw error
  }
}

export function parseReadyLine(stdout: string): BridgeReadyLine {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith('OSCDESK_BRIDGE_READY '))
  if (line === undefined) throw new Error('Bridge exited without an OSCDESK_BRIDGE_READY line.')

  const payload = JSON.parse(line.slice('OSCDESK_BRIDGE_READY '.length)) as Partial<BridgeReadyLine>
  if (!Number.isInteger(payload.wsPort) || !Number.isInteger(payload.oscListenPort)) {
    throw new Error(`Invalid OSCDESK_BRIDGE_READY line: ${line}`)
  }
  return payload as BridgeReadyLine
}

function appendOption(args: string[], flag: string, value: string | number | undefined): void {
  if (value !== undefined) args.push(flag, String(value))
}
