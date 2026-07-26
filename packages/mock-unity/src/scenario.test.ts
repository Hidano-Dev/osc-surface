import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { ManifestSchema } from '@osc-surface/shared'

import { ScenarioRuntime, ScenarioSchema, loadScenarioDefinition } from './scenario'

describe('loadScenarioDefinition', () => {
  it('loads the default scenario file with Japanese character name candidates', () => {
    const definition = loadScenarioDefinition(
      path.resolve(__dirname, '../scenarios/default.json'),
    )

    expect(definition.characterName?.candidates).toEqual(['初音ミク', '鏡音リン', '巡音ルカ'])
    expect(definition.projectId).toBe('osc-surface-demo')
    expect(definition.entries[0]).toMatchObject({
      address: '/avatar/blend/smile',
      label: '{characterName} Smile',
    })
  })
})

describe('ScenarioRuntime', () => {
  it('expands placeholders and reflects current values in the manifest JSON', () => {
    const runtime = new ScenarioRuntime(
      ScenarioSchema.parse({
        projectId: 'osc-surface-demo',
        characterName: {
          candidates: ['初音ミク', '巡音ルカ'],
        },
        entries: [
          {
            address: '/avatar/blend/smile',
            label: '{characterName} Smile',
            type: 'f',
            widget: 'fader',
            range: [0, 1],
            default: 0.25,
            group: 'Face',
          },
          {
            address: '/avatar/text/name',
            label: 'Character Name',
            type: 's',
            widget: 'text',
            default: '{characterName}',
            group: 'Profile',
          },
          {
            address: '/avatar/toggle/visible',
            label: 'Visible',
            type: 'bool',
            widget: 'toggle',
            default: true,
          },
        ],
      }),
      { characterName: '鏡音リン' },
    )

    runtime.recordValue('/avatar/blend/smile', 0.75)
    runtime.recordValue('/avatar/text/name', '鏡音リン')
    runtime.recordValue('/avatar/toggle/visible', false)
    runtime.recordValue('/sys/manifest/request', 1)
    runtime.recordValue('/avatar/blend/smile', true)

    const manifest = ManifestSchema.parse(JSON.parse(runtime.manifestJson()))

    expect(runtime.characterName).toBe('鏡音リン')
    expect(manifest.projectId).toBe('osc-surface-demo')
    expect(manifest.entries).toEqual([
      {
        address: '/avatar/blend/smile',
        label: '鏡音リン Smile',
        type: 'f',
        widget: 'fader',
        range: [0, 1],
        default: 0.75,
        group: 'Face',
      },
      {
        address: '/avatar/text/name',
        label: 'Character Name',
        type: 's',
        widget: 'text',
        default: '鏡音リン',
        group: 'Profile',
      },
      {
        address: '/avatar/toggle/visible',
        label: 'Visible',
        type: 'bool',
        widget: 'toggle',
        default: false,
      },
    ])
  })

  it('generates a deterministic character name with a random suffix when requested', () => {
    const randomValues = [0.75, 0.042]
    const runtime = new ScenarioRuntime(
      ScenarioSchema.parse({
        projectId: 'osc-surface-demo',
        characterName: {
          candidates: ['初音ミク', '鏡音リン', '巡音ルカ'],
          randomSuffix: true,
        },
        entries: [
          {
            address: '/avatar/text/name',
            label: '{characterName}',
            type: 's',
            widget: 'text',
            default: '{characterName}',
          },
        ],
      }),
      {
        random: () => randomValues.shift() ?? 0,
      },
    )

    expect(runtime.characterName).toBe('巡音ルカ-042')
    expect(ManifestSchema.parse(JSON.parse(runtime.manifestJson())).entries[0]?.default).toBe(
      '巡音ルカ-042',
    )
  })

  it('returns the raw manifest override unchanged', () => {
    const runtime = new ScenarioRuntime(
      ScenarioSchema.parse({
        projectId: 'osc-surface-demo',
        entries: [],
        rawManifestOverride: '{"version":"broken"}',
      }),
    )

    runtime.recordValue('/avatar/blend/smile', 0.5)

    expect(runtime.characterName).toBeNull()
    expect(runtime.manifestJson()).toBe('{"version":"broken"}')
  })

  it('creates a manifest with the wrong project identifier for the misconnection scenario', () => {
    const definition = loadScenarioDefinition(
      path.resolve(__dirname, '../scenarios/wrong-project.json'),
    )

    const manifest = ManifestSchema.parse(
      JSON.parse(new ScenarioRuntime(definition).manifestJson()),
    )

    expect(manifest.projectId).not.toBe('osc-surface-demo')
  })
})
