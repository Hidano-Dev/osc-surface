import { startMockUnityServer } from './server'

export * from './osc-adapter'
export * from './responder'
export * from './server'

export interface MockUnityCliOptions {
  listenPort: number
  replyHost?: string
  replyPort?: number
}

const READY_PREFIX = 'MOCK_UNITY_READY'

export function parseCliArgs(argv: readonly string[]): MockUnityCliOptions {
  const args = [...argv]
  let listenPort: number | null = null
  let replyHost: string | undefined
  let replyPort: number | undefined

  while (args.length > 0) {
    const flag = args.shift()

    switch (flag) {
      case '--listen-port':
        listenPort = parsePort(readRequiredValue(flag, args), flag)
        break
      case '--reply-host':
        replyHost = readRequiredValue(flag, args)
        break
      case '--reply-port':
        replyPort = parsePort(readRequiredValue(flag, args), flag)
        break
      default:
        throw new Error(`Unknown argument: ${flag}`)
    }
  }

  if (listenPort === null) {
    throw new Error('Missing required argument: --listen-port')
  }

  if ((replyHost === undefined) !== (replyPort === undefined)) {
    throw new Error('--reply-host and --reply-port must be provided together')
  }

  return {
    listenPort,
    replyHost,
    replyPort,
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv)
  const server = await startMockUnityServer({
    listenPort: options.listenPort,
    replyTarget:
      options.replyHost !== undefined && options.replyPort !== undefined
        ? {
            host: options.replyHost,
            port: options.replyPort,
          }
        : undefined,
  })

  let closed = false

  const shutdown = async () => {
    if (closed) {
      return
    }

    closed = true
    await server.close()
  }

  process.once('SIGINT', () => {
    void shutdown().finally(() => {
      process.exit(0)
    })
  })
  process.once('SIGTERM', () => {
    void shutdown().finally(() => {
      process.exit(0)
    })
  })

  process.stdout.write(`${READY_PREFIX} ${JSON.stringify({ listenPort: server.listenPort })}\n`)
}

function readRequiredValue(flag: string, args: string[]): string {
  const value = args.shift()

  if (value === undefined) {
    throw new Error(`Missing value for ${flag}`)
  }

  return value
}

function parsePort(raw: string, flag: string): number {
  const port = Number(raw)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port for ${flag}: ${raw}`)
  }

  return port
}

if (require.main === module) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
