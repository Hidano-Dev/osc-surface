import dgram from 'node:dgram'
import net from 'node:net'

/** 空いている UDP ポートを 1 つ確保して返す(確保後すぐに解放する)。 */
export async function reserveUdpPort(): Promise<number> {
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
      throw new Error('Expected an IPv4 UDP address while reserving a port.')
    }

    return address.port
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

/** 空いている TCP ポートを 1 つ確保して返す(確保後すぐに解放する)。 */
export async function reserveTcpPort(): Promise<number> {
  const server = net.createServer()

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })

    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Expected an IPv4 TCP address while reserving an HTTP port.')
    }

    return address.port
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}
