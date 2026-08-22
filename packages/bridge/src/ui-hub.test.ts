import { WebSocket } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'

import { startUiHub, type UiHub } from './ui-hub'

const open = (port: number, path = '/ignored/path') => new Promise<WebSocket>((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  socket.once('open', () => resolve(socket))
  socket.once('error', reject)
})

const nextMessage = (socket: WebSocket) => new Promise<unknown>(resolve => {
  socket.once('message', data => resolve(JSON.parse(data.toString())))
})

const closeSocket = (socket: WebSocket) => new Promise<void>(resolve => {
  if (socket.readyState === WebSocket.CLOSED) return resolve()
  socket.once('close', () => resolve())
  socket.close()
})

describe('UiHub', () => {
  let hub: UiHub | undefined

  afterEach(async () => {
    if (hub) await hub.close()
    hub = undefined
  })

  it('starts, sends to all or one client, and closes', async () => {
    const connected: string[] = []
    hub = await startUiHub({
      port: 0,
      onConnect: id => connected.push(id),
      onDisconnect: () => undefined,
      onFrame: () => undefined,
      onInvalidFrame: () => undefined,
    })
    const first = await open(hub.port)
    const second = await open(hub.port)
    expect(hub.clientCount).toBe(2)

    const frame = { v: 1 as const, type: 'notice' as const, level: 'info' as const, code: 'test', detail: 'hello' }
    const firstBroadcast = nextMessage(first)
    const secondBroadcast = nextMessage(second)
    hub.broadcast(frame)
    await expect(firstBroadcast).resolves.toEqual(frame)
    await expect(secondBroadcast).resolves.toEqual(frame)

    const onlyFirst = nextMessage(first)
    hub.sendTo(connected[0], { ...frame, detail: 'private' })
    await expect(onlyFirst).resolves.toMatchObject({ detail: 'private' })
    await closeSocket(first)
    await closeSocket(second)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(hub.clientCount).toBe(0)
  })

  it('propagates a bind failure', async () => {
    const first = await startUiHub({ port: 0, onConnect: () => undefined, onDisconnect: () => undefined, onFrame: () => undefined, onInvalidFrame: () => undefined })
    const port = first.port
    await expect(startUiHub({ port, onConnect: () => undefined, onDisconnect: () => undefined, onFrame: () => undefined, onInvalidFrame: () => undefined })).rejects.toBeTruthy()
    await first.close()
  })

  it('keeps the connection after an invalid frame and reports a valid frame', async () => {
    const received: unknown[] = []
    const invalid: Array<{ reason: string; preview: string }> = []
    hub = await startUiHub({
      port: 0,
      onConnect: () => undefined,
      onDisconnect: () => undefined,
      onFrame: frame => received.push(frame),
      onInvalidFrame: (_id, reason, preview) => invalid.push({ reason, preview }),
    })
    const socket = await open(hub.port, '/anything')
    const notice = nextMessage(socket)
    socket.send('x'.repeat(250))
    await expect(notice).resolves.toMatchObject({ type: 'notice', code: 'invalid-frame' })
    expect(invalid[0].preview).toHaveLength(200)

    socket.send(JSON.stringify({ v: 1, type: 'manifestRequest' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(received).toEqual([{ v: 1, type: 'manifestRequest' }])
    await closeSocket(socket)
  })

  it('rejects binary frames visibly and keeps the connection', async () => {
    const invalid: string[] = []
    hub = await startUiHub({
      port: 0,
      onConnect: () => undefined,
      onDisconnect: () => undefined,
      onFrame: () => undefined,
      onInvalidFrame: (_id, reason) => invalid.push(reason),
    })
    const socket = await open(hub.port)
    const notice = nextMessage(socket)
    socket.send(Buffer.from([0x01, 0x02, 0x03]))
    await expect(notice).resolves.toMatchObject({ type: 'notice', code: 'invalid-frame', detail: 'binary-frame' })
    expect(invalid).toEqual(['binary-frame'])
    expect(hub.clientCount).toBe(1)
    await closeSocket(socket)
  })

  it('disconnects a client after heartbeat timeout', async () => {
    let now = 0
    let heartbeat: (() => void) | undefined
    let disconnectedResolve: ((id: string) => void) | undefined
    const disconnected = new Promise<string>(resolve => { disconnectedResolve = resolve })
    hub = await startUiHub({
      port: 0,
      heartbeat: { intervalMs: 10, timeoutMs: 20 },
      now: () => now,
      setIntervalFn: callback => { heartbeat = callback; return 1 },
      clearIntervalFn: () => undefined,
      onConnect: () => undefined,
      onDisconnect: (id, reason) => { if (reason === 'heartbeat-timeout') disconnectedResolve?.(id) },
      onFrame: () => undefined,
      onInvalidFrame: () => undefined,
    })
    const socket = await open(hub.port)
    now = 21
    heartbeat?.()
    await expect(disconnected).resolves.toBeTruthy()
    await closeSocket(socket)
  })
})
