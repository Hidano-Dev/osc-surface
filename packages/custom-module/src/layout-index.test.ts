import { describe, expect, it } from 'vitest'

import { buildLayoutIndex } from './layout-index'

describe('buildLayoutIndex', () => {
  it('indexes explicit addresses and auto addresses while skipping container auto-indexing', () => {
    const layoutJson = {
      type: 'session',
      content: {
        type: 'root',
        id: 'root',
        widgets: [
          {
            type: 'fader',
            id: 'manual',
            address: '/avatar/blend/smile',
          },
          {
            type: 'button',
            id: 'trigger',
          },
          {
            type: 'panel',
            id: 'container',
            widgets: [
              {
                type: 'text',
                id: 'inside',
              },
            ],
          },
        ],
      },
    }

    const index = buildLayoutIndex(layoutJson, { excludeContainerIds: ['dynamic'] })

    expect(Array.from(index.idByAddress.entries())).toEqual([
      ['/avatar/blend/smile', 'manual'],
      ['/trigger', 'trigger'],
      ['/inside', 'inside'],
    ])
    expect(index.warnings).toEqual([])
  })

  it('excludes all widgets under configured dynamic containers', () => {
    const layoutJson = {
      widgets: [
        {
          type: 'panel',
          id: 'dynamic',
          widgets: [
            {
              type: 'fader',
              id: 'generated',
              address: '/avatar/generated',
            },
          ],
        },
        {
          type: 'fader',
          id: 'kept',
          address: '/avatar/kept',
        },
      ],
    }

    const index = buildLayoutIndex(layoutJson, { excludeContainerIds: ['dynamic'] })

    expect(Array.from(index.idByAddress.entries())).toEqual([['/avatar/kept', 'kept']])
    expect(index.warnings).toEqual([])
  })

  it('warns and keeps the first widget when duplicate addresses are found', () => {
    const layoutJson = {
      widgets: [
        {
          type: 'fader',
          id: 'first',
          address: '/avatar/blend/smile',
        },
        {
          type: 'fader',
          id: 'second',
          address: '/avatar/blend/smile',
        },
        {
          type: 'button',
          id: 'first',
        },
      ],
    }

    const index = buildLayoutIndex(layoutJson, { excludeContainerIds: [] })

    expect(Array.from(index.idByAddress.entries())).toEqual([
      ['/avatar/blend/smile', 'first'],
      ['/first', 'first'],
    ])
    expect(index.warnings).toEqual([
      'Duplicate layout address "/avatar/blend/smile" at $.widgets[1]; keeping existing widget "first" and skipping "second".',
    ])
  })

  it('returns an empty index with a warning when the layout JSON is invalid', () => {
    const index = buildLayoutIndex(null, { excludeContainerIds: ['dynamic'] })

    expect(Array.from(index.idByAddress.entries())).toEqual([])
    expect(index.warnings).toEqual(['Layout JSON must be an object; returning an empty index.'])
  })
})
