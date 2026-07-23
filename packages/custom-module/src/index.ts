import { SYS } from '@osc-surface/shared'

import { createCustomModuleRuntime } from './module-runtime'

const runtime = createCustomModuleRuntime({
  sendFn: send,
})

module.exports = {
  ...runtime,

  init() {
    console.log(`(INFO) [osc-surface] custom module loaded (sys namespace: ${Object.values(SYS).join(', ')})`)
    runtime.init()
  },
}
