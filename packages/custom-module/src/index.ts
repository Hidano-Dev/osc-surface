import { SYS } from '@oscdesk/shared'

import { createCustomModuleRuntime } from './module-runtime'

const runtime = createCustomModuleRuntime({
  receiveFn: receive,
  sendFn: send,
})

module.exports = {
  ...runtime,

  init() {
    console.log(`(INFO) [osc-surface] custom module loaded (sys namespace: ${Object.values(SYS).join(', ')})`)
    runtime.init()
  },
}
