import dgram from 'node:dgram'

import type { OscArg } from '@osc-surface/shared'

import { createOscTestClient, type OscTestClient } from './osc-client'

const POLL_INTERVAL_MS = 50

export interface WidgetInspector {
  getProps(idOrAddress: string): Promise<Record<string, unknown>>
  getValue(idOrAddress: string): Promise<OscArg[]>
  set(idOrAddress: string, value: number | string): Promise<void>
  waitForProps(
    idOrAddress: string,
    predicate: (props: Record<string, unknown>) => boolean,
    timeoutMs: number,
  ): Promise<Record<string, unknown>>
  close(): Promise<void>
}

export async function createWidgetInspector(oscTarget: {
  host: string
  port: number
}): Promise<WidgetInspector> {
  const bind = await reserveLocalUdpEndpoint()
  const client = await createOscTestClient(bind)
  return new OscWidgetInspector(client, oscTarget, `${bind.host}:${bind.port}`)
}

class OscWidgetInspector implements WidgetInspector {
  readonly #client: OscTestClient
  readonly #oscTarget: { host: string; port: number }
  readonly #replyTarget: string

  constructor(client: OscTestClient, oscTarget: { host: string; port: number }, replyTarget: string) {
    this.#client = client
    this.#oscTarget = oscTarget
    this.#replyTarget = replyTarget
  }

  async getProps(idOrAddress: string): Promise<Record<string, unknown>> {
    const response = await this.#client.request({
      to: this.#oscTarget,
      message: {
        address: '/EDIT/GET',
        args: [
          { type: 's', value: this.#replyTarget },
          { type: 's', value: idOrAddress },
        ],
      },
      expectAddress: '/EDIT/GET',
      timeoutMs: 2_000,
      retries: 1,
    })

    if (response.args.length < 2) {
      throw new Error(`Expected /EDIT/GET response to contain id and JSON props for "${idOrAddress}".`)
    }

    const propsArg = response.args[response.args.length - 1]
    if (propsArg?.type !== 's' || typeof propsArg.value !== 'string') {
      throw new Error(`Expected /EDIT/GET response to end with a JSON string for "${idOrAddress}".`)
    }

    const parsed = JSON.parse(propsArg.value) as unknown
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error(`Expected widget props for "${idOrAddress}" to decode to an object.`)
    }

    return parsed as Record<string, unknown>
  }

  async getValue(idOrAddress: string): Promise<OscArg[]> {
    const response = await this.#client.request({
      to: this.#oscTarget,
      message: {
        address: '/GET',
        args: [
          { type: 's', value: this.#replyTarget },
          { type: 's', value: idOrAddress },
        ],
      },
      expectAddress: '/GET',
      timeoutMs: 2_000,
      retries: 1,
    })

    if (response.args.length < 1) {
      throw new Error(`Expected /GET response to contain at least the widget identifier for "${idOrAddress}".`)
    }

    return response.args.slice(1)
  }

  async set(idOrAddress: string, value: number | string): Promise<void> {
    await this.#client.send(this.#oscTarget.host, this.#oscTarget.port, '/SET', [
      { type: 's', value: idOrAddress },
      toOscArg(value),
    ])
  }

  async waitForProps(
    idOrAddress: string,
    predicate: (props: Record<string, unknown>) => boolean,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs
    let lastProps: Record<string, unknown> | undefined

    while (Date.now() < deadline) {
      lastProps = await this.getProps(idOrAddress)
      if (predicate(lastProps)) {
        return lastProps
      }

      await delay(POLL_INTERVAL_MS)
    }

    throw new Error(
      `Timed out waiting for widget props "${idOrAddress}" after ${timeoutMs}ms. Last props: ${JSON.stringify(lastProps ?? null)}`,
    )
  }

  close(): Promise<void> {
    return this.#client.close()
  }
}

function toOscArg(value: number | string): OscArg {
  if (typeof value === 'string') {
    return { type: 's', value }
  }

  if (!Number.isFinite(value)) {
    throw new Error(`Expected a finite numeric widget value, received ${value}.`)
  }

  if (Number.isInteger(value)) {
    return { type: 'i', value }
  }

  return { type: 'f', value }
}

async function reserveLocalUdpEndpoint(): Promise<{ host: string; port: number }> {
  const socket = dgram.createSocket('udp4')

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(0, '127.0.0.1', () => {
        socket.off('error', reject)
        resolve()
      })
    })

    const address = socket.address()
    if (typeof address === 'string') {
      throw new Error('Expected a UDP4 address while reserving a widget inspector port.')
    }

    return { host: '127.0.0.1', port: address.port }
  } finally {
    await new Promise<void>((resolve, reject) => {
      socket.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}
