import { DYNAMIC_CONTAINER_ID } from './manifest-apply'

export const RESERVED_DYNAMIC_ID_PREFIX = 'dyn'

export interface ValidateLayoutConventionsOptions {
  requireDynamicContainer: boolean
}

interface TraversalState {
  dynamicContainerFound: boolean
}

type JsonRecord = Record<string, unknown>

export function validateLayoutConventions(layoutJson: unknown, options: ValidateLayoutConventionsOptions): string[] {
  const violations: string[] = []

  if (!isRecord(layoutJson)) {
    return violations
  }

  const state: TraversalState = { dynamicContainerFound: false }
  visitNode(layoutJson, '$', state, violations)

  if (options.requireDynamicContainer && !state.dynamicContainerFound) {
    violations.push(
      `Layout convention violation: no widget with id "${DYNAMIC_CONTAINER_ID}" found; dynamically generated manifest widgets would have no container to render into.`,
    )
  }

  return violations
}

function visitNode(node: unknown, path: string, state: TraversalState, violations: string[]): void {
  if (!isRecord(node)) {
    return
  }

  const widgetId = typeof node.id === 'string' ? node.id : null

  if (widgetId === DYNAMIC_CONTAINER_ID) {
    if (!state.dynamicContainerFound) {
      // The designated dynamic container; its children are replaced on
      // manifest apply, so ids inside it are exempt from the checks.
      state.dynamicContainerFound = true
      return
    }

    violations.push(
      `Layout convention violation: duplicate dynamic container id "${DYNAMIC_CONTAINER_ID}" at ${path}; only one dynamic container is allowed.`,
    )
  } else if (widgetId !== null && widgetId.startsWith(RESERVED_DYNAMIC_ID_PREFIX)) {
    violations.push(
      `Layout convention violation: manual widget id "${widgetId}" at ${path} uses the reserved prefix "${RESERVED_DYNAMIC_ID_PREFIX}" for dynamically generated widgets.`,
    )
  }

  const widgets = Array.isArray(node.widgets) ? node.widgets : null

  if (widgets !== null) {
    for (let index = 0; index < widgets.length; index += 1) {
      visitNode(widgets[index], `${path}.widgets[${index}]`, state, violations)
    }
  }

  visitNestedObjects(node, path, state, violations)
}

function visitNestedObjects(node: JsonRecord, path: string, state: TraversalState, violations: string[]): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'widgets' || key === 'address' || key === 'id') {
      continue
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        visitNode(value[index], `${path}.${key}[${index}]`, state, violations)
      }
      continue
    }

    visitNode(value, `${path}.${key}`, state, violations)
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}
