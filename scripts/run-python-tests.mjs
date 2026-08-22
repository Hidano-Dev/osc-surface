import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const uiRoot = join(repositoryRoot, 'packages', 'nicegui-ui')
const pythonCandidates = process.platform === 'win32'
  ? [join(uiRoot, '.venv', 'Scripts', 'python.exe'), join(uiRoot, '.venv', 'bin', 'python')]
  : [join(uiRoot, '.venv', 'bin', 'python'), join(uiRoot, '.venv', 'Scripts', 'python.exe')]
const python = pythonCandidates.find((candidate) => existsSync(candidate))

if (!python) {
  console.warn('[SKIP] Python テストをスキップしました。理由: 仮想環境が未作成です。対処: py -3 -m venv packages/nicegui-ui/.venv && packages/nicegui-ui/.venv/Scripts/python -m pip install -e "packages/nicegui-ui[dev]"')
  process.exit(0)
}

const result = spawnSync(python, ['-m', 'pytest', uiRoot, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`Python テストの起動に失敗しました: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
