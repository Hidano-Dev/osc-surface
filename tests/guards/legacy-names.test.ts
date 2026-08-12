import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
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
]

const excludedPath = (filePath: string): boolean => {
  const normalized = filePath.replaceAll('\\', '/')
  return normalized === guardPath
    || normalized === 'DESIGN.md'
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
