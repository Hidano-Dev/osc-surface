// PoC 2: O-S-C サーバーに「自作 UI の静的ファイル」を配信させられるか (--remote-root)
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')

const REPO = path.resolve(__dirname, '../..')
const UI_DIR = path.resolve(__dirname, 'myui')
const PORT = 7381

// 「自作 UI」に見立てた静的ファイルをその場で用意する
fs.mkdirSync(UI_DIR, { recursive: true })
fs.writeFileSync(
  path.join(UI_DIR, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>MY OWN UI</title><body>MY_OWN_UI_MARKER</body>\n',
)

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () => resolve({ status: res.statusCode, body }))
      })
      .on('error', reject)
  })
}

async function main() {
  const proc = spawn(
    process.execPath,
    [
      path.join(REPO, 'vendor/open-stage-control/app'),
      '-n',
      '--no-qrcode',
      '-p',
      String(PORT),
      '--remote-root',
      UI_DIR,
    ],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let out = ''
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout\n' + out)), 20000)
    proc.stdout.on('data', (d) => {
      out += d.toString()
      if (out.includes('Server started')) {
        clearTimeout(t)
        resolve()
      }
    })
    proc.stderr.on('data', (d) => process.stderr.write('[err] ' + d.toString()))
  })

  const own = await get(`http://127.0.0.1:${PORT}/index.html`)
  const builtin = await get(`http://127.0.0.1:${PORT}/`)

  console.log('\n===== RESULT =====')
  console.log('/index.html  status:', own.status, '| contains MY_OWN_UI_MARKER:', own.body.includes('MY_OWN_UI_MARKER'))
  console.log('/            status:', builtin.status, '| built-in client served:', builtin.body.includes('__APP_DIR__') || builtin.body.includes('window.ENV'))
  console.log('==================\n')

  proc.kill()
  setTimeout(() => process.exit(0), 500)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
