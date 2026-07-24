import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'

export interface SpawnSpec {
  command: string
  args: string[]
  env?: Record<string, string>
  readyPattern: RegExp
  readyTimeoutMs: number
}

export interface ManagedProcess {
  readonly pid: number
  stop(): Promise<void>
  stdoutSnapshot(): string
}

interface ProcessLog {
  readonly name: 'stdout' | 'stderr'
  readonly chunk: string
}

export class ProcessHarness {
  readonly #processes = new Set<ManagedChildProcess>()

  async start(spec: SpawnSpec): Promise<ManagedProcess> {
    const child = spawn(spec.command, spec.args, {
      env: spec.env === undefined ? process.env : { ...process.env, ...spec.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const managed = new ManagedChildProcess(child)
    this.#processes.add(managed)

    managed.onExit().finally(() => {
      this.#processes.delete(managed)
    })

    try {
      await managed.waitForReady(spec.readyPattern, spec.readyTimeoutMs)
      return managed
    } catch (error) {
      await managed.stop().catch(() => undefined)
      throw augmentError(error, managed.describeFailure(spec))
    }
  }

  async stopAll(): Promise<void> {
    const stops = [...this.#processes].map(async (managed) => {
      await managed.stop()
      this.#processes.delete(managed)
    })

    await Promise.all(stops)
  }
}

class ManagedChildProcess implements ManagedProcess {
  readonly #child: ChildProcess
  readonly #logs: ProcessLog[] = []
  readonly #exitPromise: Promise<void>
  #stopPromise?: Promise<void>
  #stdout = ''

  constructor(child: ChildProcess) {
    this.#child = child

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')

    child.stdout?.on('data', (chunk: string) => {
      this.#stdout += chunk
      this.#logs.push({ name: 'stdout', chunk })
    })

    child.stderr?.on('data', (chunk: string) => {
      this.#logs.push({ name: 'stderr', chunk })
    })

    this.#exitPromise = once(child, 'exit').then(() => undefined)
  }

  get pid(): number {
    const pid = this.#child.pid

    if (pid === undefined) {
      throw new Error('Child process PID is not available')
    }

    return pid
  }

  async waitForReady(readyPattern: RegExp, readyTimeoutMs: number): Promise<void> {
    const deadline = Date.now() + readyTimeoutMs

    for (;;) {
      if (matchesReady(readyPattern, this.#stdout)) {
        return
      }

      if (this.#child.exitCode !== null) {
        throw new Error(`Process exited before ready signal with code ${this.#child.exitCode}`)
      }

      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        throw new Error(`Timed out waiting for ready signal after ${readyTimeoutMs}ms`)
      }

      await Promise.race([
        once(this.#child.stdout ?? this.#child, 'data').then(() => undefined),
        this.#exitPromise.then(() => undefined),
        delay(remainingMs),
      ])
    }
  }

  onExit(): Promise<void> {
    return this.#exitPromise
  }

  async stop(): Promise<void> {
    if (this.#stopPromise !== undefined) {
      return this.#stopPromise
    }

    if (this.#child.exitCode !== null || this.#child.killed) {
      this.#stopPromise = this.#exitPromise
      return this.#stopPromise
    }

    this.#stopPromise = (async () => {
      await stopChildProcess(this.pid, this.#child)
      await this.#exitPromise
    })()

    await this.#stopPromise
  }

  stdoutSnapshot(): string {
    return this.#stdout
  }

  describeFailure(spec: SpawnSpec): string {
    const logOutput = this.#logs
      .map(({ name, chunk }) => `[${name}] ${chunk.trimEnd()}`)
      .filter((line) => line.length > 0)
      .join('\n')

    return [
      `Failed to start process: ${spec.command} ${spec.args.join(' ')}`.trimEnd(),
      `PID: ${this.#child.pid ?? 'unknown'}`,
      `Ready pattern: ${spec.readyPattern}`,
      logOutput.length > 0 ? `Captured output:\n${logOutput}` : 'Captured output: <none>',
    ].join('\n')
  }
}

async function stopChildProcess(pid: number, child: ChildProcess): Promise<void> {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore',
    })

    const [code] = (await once(killer, 'exit')) as [number | null]
    if (code !== 0 && child.exitCode === null) {
      throw new Error(`taskkill failed for PID ${pid} with exit code ${code ?? 'null'}`)
    }

    await waitForExitCode(child, 5_000)
    return
  }

  child.kill('SIGKILL')
  await waitForExitCode(child, 5_000)
}

function matchesReady(pattern: RegExp, stdout: string): boolean {
  pattern.lastIndex = 0
  return pattern.test(stdout)
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

async function waitForExitCode(child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (child.exitCode === null) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for PID ${child.pid ?? 'unknown'} to exit.`)
    }

    await delay(50)
  }
}

function augmentError(error: unknown, detail: string): Error {
  if (error instanceof Error) {
    error.message = `${error.message}\n${detail}`
    return error
  }

  return new Error(`${String(error)}\n${detail}`)
}
