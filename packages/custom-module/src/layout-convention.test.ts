import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { validateLayoutConventions } from './layout-convention'

const LAYOUTS_DIR = path.resolve(__dirname, '../../../layouts')
const MAIN_LAYOUT_FILE = 'main.json'

function sessionLayout(widgets: unknown[]): unknown {
  return {
    type: 'session',
    content: {
      type: 'root',
      id: 'root',
      widgets,
    },
  }
}

describe('validateLayoutConventions', () => {
  it('accepts a layout with manual widgets and a single dynamic container', () => {
    const layoutJson = sessionLayout([
      { type: 'fader', id: 'smile_blend', address: '/avatar/blend/smile' },
      { type: 'panel', id: 'dynamic', widgets: [{ type: 'text', id: 'dynamic_placeholder' }] },
    ])

    expect(validateLayoutConventions(layoutJson, { requireDynamicContainer: true })).toEqual([])
  })

  it('flags manual widget ids that use the reserved "dyn" prefix', () => {
    const layoutJson = sessionLayout([
      { type: 'fader', id: 'dyn_smile', address: '/avatar/blend/smile' },
      { type: 'panel', id: 'dynamic', widgets: [] },
    ])

    const violations = validateLayoutConventions(layoutJson, { requireDynamicContainer: true })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('"dyn_smile"')
    expect(violations[0]).toContain('$.content.widgets[0]')
  })

  it('flags a second widget with the dynamic container id', () => {
    const layoutJson = sessionLayout([
      { type: 'panel', id: 'dynamic', widgets: [] },
      { type: 'panel', id: 'dynamic', widgets: [] },
    ])

    const violations = validateLayoutConventions(layoutJson, { requireDynamicContainer: true })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('duplicate dynamic container id')
    expect(violations[0]).toContain('$.content.widgets[1]')
  })

  it('ignores reserved ids inside the dynamic container because they are replaced on apply', () => {
    const layoutJson = sessionLayout([
      { type: 'panel', id: 'dynamic', widgets: [{ type: 'text', id: 'dyn_leftover' }] },
    ])

    expect(validateLayoutConventions(layoutJson, { requireDynamicContainer: true })).toEqual([])
  })

  it('flags reserved ids in nested non-widget arrays such as tabs', () => {
    const layoutJson = sessionLayout([
      {
        type: 'panel',
        id: 'tabbed',
        tabs: [{ type: 'tab', id: 'dyn_tab' }],
      },
      { type: 'panel', id: 'dynamic', widgets: [] },
    ])

    const violations = validateLayoutConventions(layoutJson, { requireDynamicContainer: true })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('"dyn_tab"')
  })

  it('reports a missing dynamic container only when required', () => {
    const layoutJson = sessionLayout([{ type: 'fader', id: 'smile_blend', address: '/avatar/blend/smile' }])

    expect(validateLayoutConventions(layoutJson, { requireDynamicContainer: true })).toHaveLength(1)
    expect(validateLayoutConventions(layoutJson, { requireDynamicContainer: false })).toEqual([])
  })

  it('returns no violations for non-object input', () => {
    expect(validateLayoutConventions(null, { requireDynamicContainer: true })).toEqual([])
  })
})

describe('repository layout files', () => {
  const layoutFiles = readdirSync(LAYOUTS_DIR).filter((fileName) => fileName.endsWith('.json'))

  it('includes the main layout', () => {
    expect(layoutFiles).toContain(MAIN_LAYOUT_FILE)
  })

  it.each(layoutFiles)('%s follows the dynamic-widget id conventions', (fileName) => {
    const layoutJson = JSON.parse(readFileSync(path.join(LAYOUTS_DIR, fileName), 'utf8')) as unknown

    const violations = validateLayoutConventions(layoutJson, {
      // Only the launched session needs the dynamic container; fragments do not.
      requireDynamicContainer: fileName === MAIN_LAYOUT_FILE,
    })

    expect(violations).toEqual([])
  })
})
