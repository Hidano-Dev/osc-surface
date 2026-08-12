// PoC: O-S-C サーバーを「UI 無しの OSC<->WebSocket ブリッジ」として使えるかの実証
// 内蔵クライアント (ブラウザ UI) を一切ロードせず、素の ws クライアントだけで双方向疎通するかを確認する。
const { spawn } = require('child_process')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const VENDOR_NM = path.join(REPO, 'vendor/open-stage-control/node_modules')
const osc = require(path.join(VENDOR_NM, 'osc'))
const WebSocket = require(path.join(VENDOR_NM, 'ws'))

const HTTP_PORT = 7380 // O-S-C の http/ws ポート (= OSC 受信ポートも兼ねる)
const UNITY_PORT = 7391 // 「Unity 役」の UDP ポート

const log = (...a) => console.log('[poc]', ...a)
const results = {}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [path.join(REPO, 'vendor/open-stage-control/app'), '-n', '--no-qrcode', '-p', String(HTTP_PORT), '-o', String(HTTP_PORT)],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let out = ''
    const timer = setTimeout(() => reject(new Error('server start timeout\n' + out)), 20000)
    proc.stdout.on('data', (d) => {
      out += d.toString()
      process.stdout.write('[osc-server] ' + d.toString())
      if (out.includes('Server started')) {
        clearTimeout(timer)
        resolve(proc)
      }
    })
    proc.stderr.on('data', (d) => process.stderr.write('[osc-server:err] ' + d.toString()))
    proc.on('exit', (code) => log('server exited', code))
  })
}

function startFakeUnity() {
  return new Promise((resolve) => {
    const port = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: UNITY_PORT, metadata: true })
    port.on('ready', () => resolve(port))
    port.open()
  })
}

async function main() {
  const server = await startServer()
  const unity = await startFakeUnity()
  log('fake unity listening on udp', UNITY_PORT)

  // 内蔵クライアントの HTML/JS は一切読み込まず、WebSocket だけを直接開く
  const ws = new WebSocket(`ws://127.0.0.1:${HTTP_PORT}/poc-client/`)
  const wsFrames = []

  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  log('websocket connected (built-in client never loaded)')

  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString())
    wsFrames.push(frame)
    if (frame[0] !== 'ping') log('ws <-', JSON.stringify(frame).slice(0, 200))
  })

  ws.send(JSON.stringify(['open', {}]))

  // --- 方向 1: 自作 UI -> WebSocket -> O-S-C -> UDP -> Unity ---
  const gotUdp = new Promise((resolve) => {
    unity.on('message', (msg, timetag, info) => {
      log('unity <- udp', msg.address, JSON.stringify(msg.args), 'from', info.address + ':' + info.port)
      resolve(msg)
    })
  })

  ws.send(
    JSON.stringify([
      'sendOsc',
      {
        address: '/poc/from-ui',
        v: 0.5,
        typeTags: 'f',
        target: [`127.0.0.1:${UNITY_PORT}`],
      },
    ]),
  )

  results.uiToUnity = await Promise.race([
    gotUdp,
    new Promise((_, r) => setTimeout(() => r(new Error('timeout: UI -> Unity')), 5000)),
  ]).catch((e) => e.message)

  // --- 方向 2: Unity -> UDP -> O-S-C -> WebSocket -> 自作 UI ---
  const gotWs = new Promise((resolve) => {
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString())
      if (frame[0] === 'receiveOsc') resolve(frame[1])
    })
  })

  unity.send(
    { address: '/poc/to-ui', args: [{ type: 'i', value: 42 }, { type: 's', value: 'hello' }] },
    '127.0.0.1',
    HTTP_PORT,
  )

  results.unityToUi = await Promise.race([
    gotWs,
    new Promise((_, r) => setTimeout(() => r(new Error('timeout: Unity -> UI')), 5000)),
  ]).catch((e) => e.message)

  console.log('\n===== RESULT =====')
  console.log('UI -> Unity :', JSON.stringify(results.uiToUnity))
  console.log('Unity -> UI :', JSON.stringify(results.unityToUi))
  console.log('==================\n')

  ws.close()
  unity.close()
  server.kill()
  setTimeout(() => process.exit(0), 500)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
