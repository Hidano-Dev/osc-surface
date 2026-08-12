import { describe, expect, it, vi } from 'vitest'

import { createLayoutSnapshotStore } from './layout-snapshot'

const layout = (widgets: unknown[] = [{ type: 'panel', id: 'dynamic', widgets: [] }]) => ({
  content: { type: 'root', id: 'root', widgets },
})

describe('LayoutSnapshotStore', () => {
  it('returns null after an initial load failure', () => {
    const store = createLayoutSnapshotStore({ loadLayout: () => undefined })

    const result = store.refresh()

    expect(result).toEqual({ ok: false, error: 'Layout JSON must be an object.', lastGood: null })
    expect(store.current()).toBeNull()
  })

  it('keeps the last good snapshot after a later failure', () => {
    const loadLayout = vi.fn().mockReturnValueOnce(layout()).mockImplementationOnce(() => {
      throw new Error('invalid JSON')
    })
    const store = createLayoutSnapshotStore({ loadLayout })

    const first = store.refresh()
    const second = store.refresh()

    expect(first.ok).toBe(true)
    expect(second).toEqual({ ok: false, error: 'invalid JSON', lastGood: store.current() })
    expect(store.current()).toBe(first.ok ? first.snapshot : null)
  })

  it('counts only dynamic container widget types and warns on duplicates', () => {
    const store = createLayoutSnapshotStore({
      loadLayout: () =>
        layout([
          { type: 'panel', id: 'dynamic', widgets: [] },
          { type: 'modal', id: 'dynamic', widgets: [] },
          { type: 'fader', id: 'dynamic' },
        ]),
    })

    const result = store.refresh()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.dynamicContainerCount).toBe(2)
      expect(result.snapshot.warnings.some((warning) => warning.includes('duplicate dynamic container'))).toBe(true)
    }
  })

  it('uses an empty root widget list and records a warning when content.widgets is absent', () => {
    const store = createLayoutSnapshotStore({ loadLayout: () => ({ content: { type: 'root' } }) })

    const result = store.refresh()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.rootWidgets).toEqual([])
      expect(result.snapshot.warnings).toContain('Layout content.widgets must be an array; using an empty root widget list.')
    }
  })
})
