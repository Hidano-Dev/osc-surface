import { exitCodeFor, main } from './main'

export * from './bridge-server'
export * from './cli'
export * from './main'

if (require.main === module) {
  void main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`OSCDESK_BRIDGE_ERROR ${JSON.stringify({ message })}\n`)
    process.exit(exitCodeFor(error))
  })
}
