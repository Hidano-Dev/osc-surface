import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(__dirname, '../..')
const guardPath = relative(repositoryRoot, __filename).replaceAll('\\', '/')

// Keep the guard's own source out of its results by constructing each token.
const legacyTokens = [
  ['/', 'surface', '/'].join(''),
  ['osc', '-', 'surface'].join(''),
  ['osc', '_', 'surface'].join(''),
  ['OSC', '_', 'SURFACE'].join(''),
  ['OSC', ' ', 'Surface'].join(''),
  ['open', '-', 'stage', '-', 'control'].join(''),
  // 撤去した基盤の呼称。これを見落としていたため、UI ラベルや CLI ヘルプに
  // O-S-C 前提の記述が残ったまま段 8 を通過してしまった。
  ['Open', ' ', 'Stage', ' ', 'Control'].join(''),
  ['O', '-', 'S', '-', 'C'].join(''),
]

/**
 * 除外は「内容が凍結されている記録」に限る。生きている資産を除外に足すと、
 * このガードが残作業を隠す装置になるので足さないこと。
 *
 * - guardPath: 本テスト自身(検出文字列の定義を自己一致させないため)
 * - DESIGN.md: 過去の設計判断の記録。旧構成の判断を書き換えると記録が嘘になる
 * - claude-code-initial-prompt.md: 初回指示の原文。同上
 * - docs/MIGRATION_OSCDESK.md: 旧名から新名への移行手順。旧名の記載が本文の目的
 * - .kiro/specs/**: 承認済み仕様の記録
 */
const excludedPath = (filePath: string): boolean => {
  const normalized = filePath.replaceAll('\\', '/')
  return normalized === guardPath
    || normalized === 'DESIGN.md'
    || normalized === 'claude-code-initial-prompt.md'
    || normalized === 'docs/MIGRATION_OSCDESK.md'
    || normalized.startsWith('.kiro/specs/')
    || normalized.startsWith('node_modules/')
    || normalized.startsWith('.git/')
    || normalized.startsWith('logs/')
}

const trackedTextFiles = (): string[] => execFileSync(
  'git',
  ['ls-files', '-z'],
  { cwd: repositoryRoot, encoding: 'buffer' },
).toString('utf8')
  .split('\0')
  .filter((filePath) => filePath.length > 0 && !excludedPath(filePath))

const findLegacyNames = (): string[] => {
  const occurrences: string[] = []

  for (const filePath of trackedTextFiles()) {
    const absolutePath = resolve(repositoryRoot, filePath)
    if (!existsSync(absolutePath)) continue
    if (!statSync(absolutePath).isFile()) continue
    const contents = readFileSync(absolutePath)
    if (contents.includes(0)) continue

    const lines = contents.toString('utf8').split(/\r?\n/)
    const matches = new Set<string>()
    lines.forEach((line, index) => {
      for (const token of legacyTokens) {
        if (line.includes(token)) matches.add(`${token} (line ${index + 1})`)
      }
    })

    if (matches.size > 0) occurrences.push(`${filePath}: ${[...matches].join(', ')}`)
  }

  return occurrences
}

describe('legacy name guard', () => {
  it('reports legacy names remaining in tracked text files', () => {
    const occurrences = findLegacyNames()
    expect(occurrences, `Legacy names found:\n${occurrences.join('\n')}`).toEqual([])
  })
})
