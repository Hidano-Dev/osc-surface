import { describe, expect, it } from 'vitest'

import type { Manifest, ManifestEntry } from '@osc-surface/shared'

import { buildApplyPlan, DYNAMIC_CONTAINER_ID, dynamicWidgetId } from './manifest-apply'

describe('buildApplyPlan', () => {
  it('updates mapped widgets and leaves unmatched layout widgets untouched', () => {
    const plan = buildApplyPlan(
      manifest([
        entry({
          address: '/avatar/blend/smile',
          label: 'Smile',
          widget: 'fader',
          type: 'f',
          range: [0, 1],
          default: 0.4,
        }),
      ]),
      {
        idByAddress: new Map([
          ['/avatar/blend/smile', 'smile_existing'],
          ['/avatar/other', 'other_existing'],
        ]),
        warnings: [],
      },
    )

    expect(plan.edits).toEqual([
      {
        widgetId: 'smile_existing',
        props: {
          label: 'Smile',
          range: { min: 0, max: 1 },
        },
      },
      {
        widgetId: DYNAMIC_CONTAINER_ID,
        props: { widgets: [] },
      },
    ])
    expect(plan.valueSyncs).toEqual([
      {
        address: '/avatar/blend/smile',
        arg: { type: 'f', value: 0.4 },
      },
    ])
    expect(plan.warnings).toEqual([])
  })

  it('generates dynamic widgets with deterministic ids, defaults, and grouped panels', () => {
    const plan = buildApplyPlan(
      manifest([
        entry({
          address: '/avatar/generated/fx',
          label: 'FX',
          widget: 'toggle',
          type: 'bool',
          default: true,
        }),
        entry({
          address: '/avatar/generated/name',
          label: 'Name',
          widget: 'text',
          type: 's',
          default: 'Alice',
          group: 'Profile',
        }),
      ]),
      {
        idByAddress: new Map(),
        warnings: [],
      },
    )

    expect(plan.edits).toEqual([
      {
        widgetId: DYNAMIC_CONTAINER_ID,
        props: {
          widgets: [
            {
              type: 'button',
              id: 'dyn_avatar_generated_fx',
              address: '/avatar/generated/fx',
              label: 'FX',
              mode: 'toggle',
              on: 1,
              off: 0,
              default: 1,
            },
            {
              type: 'panel',
              id: 'dyn_group_Profile_panel',
              label: 'Profile',
              layout: 'vertical',
              widgets: [
                {
                  type: 'text',
                  id: 'dyn_group_Profile_panel__heading',
                  default: 'Profile',
                  interaction: false,
                },
                {
                  type: 'text',
                  id: 'dyn_avatar_generated_name',
                  address: '/avatar/generated/name',
                  label: 'Name',
                  interaction: false,
                  default: 'Alice',
                },
              ],
            },
          ],
        },
      },
    ])
    expect(plan.valueSyncs).toEqual([
      {
        address: '/avatar/generated/fx',
        arg: { type: 'i', value: 1 },
      },
      {
        address: '/avatar/generated/name',
        arg: { type: 's', value: 'Alice' },
      },
    ])
    expect(plan.warnings).toEqual([])
  })

  it('suffixes generated ids when they collide with layout ids or other generated ids', () => {
    const manifestInput = manifest([
      entry({ address: '/a/b', widget: 'fader', type: 'f' }),
      entry({ address: '/a_b', widget: 'fader', type: 'f' }),
      entry({ address: '/avatar/generated/wave', widget: 'fader', type: 'f' }),
      entry({ address: '/avatar/generated/wave', widget: 'fader', type: 'f' }),
      entry({ address: '/avatar/generated/wave_2', widget: 'fader', type: 'f' }),
      entry({ address: '/avatar/generated/group', widget: 'fader', type: 'f', group: 'generated' }),
    ])

    const firstPlan = buildApplyPlan(manifestInput, {
      idByAddress: new Map(),
      widgetIds: new Set(['dyn_a_b', 'dyn_avatar_generated_wave', 'dyn_avatar_generated_wave_2', 'root', 'dynamic']),
      excludedContainerHits: new Map(),
      warnings: [],
    })
    const secondPlan = buildApplyPlan(manifestInput, {
      idByAddress: new Map(),
      widgetIds: new Set(['dyn_a_b', 'dyn_avatar_generated_wave', 'dyn_avatar_generated_wave_2', 'root', 'dynamic']),
      excludedContainerHits: new Map(),
      warnings: [],
    })

    expect(firstPlan).toEqual(secondPlan)
    const widgets = (firstPlan.edits.at(-1)?.props.widgets as Record<string, unknown>[]) ?? []
    expect(widgets.map((widget) => widget.id)).toEqual([
      'dyn_a_b_2',
      'dyn_a_b_3',
      'dyn_avatar_generated_wave_3',
      'dyn_avatar_generated_wave_4',
      'dyn_avatar_generated_wave_2_2',
      'dyn_group_generated_panel',
    ])
    expect((widgets[5]?.widgets as Record<string, unknown>[]).map((widget) => widget.id)).toEqual([
      'dyn_group_generated_panel__heading',
      'dyn_avatar_generated_group',
    ])
    expect(firstPlan.selfHealEvents).toEqual([
      {
        kind: 'id-collision',
        address: '/a/b',
        requestedId: 'dyn_a_b',
        assignedId: 'dyn_a_b_2',
      },
      {
        kind: 'id-collision',
        address: '/a_b',
        requestedId: 'dyn_a_b',
        assignedId: 'dyn_a_b_3',
      },
      {
        kind: 'id-collision',
        address: '/avatar/generated/wave',
        requestedId: 'dyn_avatar_generated_wave',
        assignedId: 'dyn_avatar_generated_wave_3',
      },
      {
        kind: 'id-collision',
        address: '/avatar/generated/wave',
        requestedId: 'dyn_avatar_generated_wave',
        assignedId: 'dyn_avatar_generated_wave_4',
      },
      {
        kind: 'id-collision',
        address: '/avatar/generated/wave_2',
        requestedId: 'dyn_avatar_generated_wave_2',
        assignedId: 'dyn_avatar_generated_wave_2_2',
      },
    ])
  })

  it('rebuilds the dynamic container from scratch on each manifest', () => {
    const firstPlan = buildApplyPlan(
      manifest([
        entry({
          address: '/avatar/generated/first',
          label: 'First',
          widget: 'fader',
          type: 'f',
        }),
      ]),
      { idByAddress: new Map(), warnings: [] },
    )
    const secondPlan = buildApplyPlan(manifest([]), { idByAddress: new Map(), warnings: [] })

    expect(firstPlan.edits[0]).toEqual({
      widgetId: DYNAMIC_CONTAINER_ID,
      props: {
        widgets: [
          {
            type: 'fader',
            id: 'dyn_avatar_generated_first',
            address: '/avatar/generated/first',
            label: 'First',
          },
        ],
      },
    })
    expect(secondPlan.edits).toEqual([
      {
        widgetId: DYNAMIC_CONTAINER_ID,
        props: { widgets: [] },
      },
    ])
  })

  it('applies xy ranges to both axes and warns for unsupported text ranges', () => {
    const plan = buildApplyPlan(
      manifest([
        entry({
          address: '/avatar/generated/position',
          label: 'Position',
          widget: 'xy',
          type: 'f',
          range: [-1, 1],
        }),
        entry({
          address: '/avatar/generated/notes',
          label: 'Notes',
          widget: 'text',
          type: 's',
          range: [0, 1],
        }),
      ]),
      { idByAddress: new Map(), warnings: [] },
    )

    const widgets = (plan.edits[0]?.props.widgets as Record<string, unknown>[]) ?? []

    expect(widgets).toEqual([
      {
        type: 'xy',
        id: 'dyn_avatar_generated_position',
        address: '/avatar/generated/position',
        label: 'Position',
        rangeX: { min: -1, max: 1 },
        rangeY: { min: -1, max: 1 },
      },
      {
        type: 'text',
        id: 'dyn_avatar_generated_notes',
        address: '/avatar/generated/notes',
        label: 'Notes',
        interaction: false,
      },
    ])
    expect(plan.warnings).toEqual([
      'Ignoring range for "/avatar/generated/notes" because widget "text" does not support range props.',
    ])
  })

  it('skips binary sync and warns when defaults do not fit the widget value type', () => {
    const plan = buildApplyPlan(
      manifest([
        entry({
          address: '/avatar/generated/blob',
          label: 'Blob',
          widget: 'button',
          type: 'b',
          default: 'raw',
        }),
        entry({
          address: '/avatar/generated/count',
          label: 'Count',
          widget: 'fader',
          type: 'i',
          default: 1.5,
        }),
      ]),
      { idByAddress: new Map(), warnings: [] },
    )

    expect(plan.valueSyncs).toEqual([])
    expect(plan.edits).toEqual([
      {
        widgetId: DYNAMIC_CONTAINER_ID,
        props: {
          widgets: [
            {
              type: 'button',
              id: 'dyn_avatar_generated_blob',
              address: '/avatar/generated/blob',
              label: 'Blob',
              mode: 'push',
            },
            {
              type: 'fader',
              id: 'dyn_avatar_generated_count',
              address: '/avatar/generated/count',
              label: 'Count',
            },
          ],
        },
      },
    ])
    expect(plan.warnings).toEqual([
      'Skipping value sync for "/avatar/generated/blob" because type "b" is not supported for UI value sync.',
      'Skipping value sync for "/avatar/generated/count" because type "i" requires an integer default.',
    ])
  })
})

describe('dynamicWidgetId', () => {
  it('normalizes OSC addresses into deterministic widget ids', () => {
    expect(dynamicWidgetId('/avatar/blend/smile')).toBe('dyn_avatar_blend_smile')
    expect(dynamicWidgetId('/avatar//with spaces')).toBe('dyn_avatar_with_spaces')
    expect(dynamicWidgetId('/')).toBe('dyn_root')
  })
})

function manifest(entries: ManifestEntry[]): Manifest {
  return {
    version: 1,
    entries,
  }
}

function entry(overrides: Partial<ManifestEntry>): ManifestEntry {
  return {
    address: '/avatar/value',
    label: 'Value',
    type: 'f',
    widget: 'fader',
    ...overrides,
  }
}
