import { defineConfig, defineProject } from 'vitest/config'

const exclude = ['**/node_modules/**', '**/dist/**', '**/.git/**']

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      defineProject({
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'tests/guards/**/*.test.ts'],
          exclude,
        },
      }),
      defineProject({
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.e2e.test.ts'],
          // 旧 O-S-C E2E は 4.2–4.6 でブリッジ方式へ書き換える。
          exclude: [
            ...exclude,
            'tests/e2e/osc-native-ui.e2e.test.ts',
          ],
          fileParallelism: false,
          poolOptions: {
            forks: {
              singleFork: true,
            },
          },
          testTimeout: 120000,
          hookTimeout: 120000,
        },
      }),
    ],
  },
})
