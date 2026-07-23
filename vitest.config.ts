import { defineConfig, defineProject } from 'vitest/config'

const exclude = ['**/node_modules/**', '**/dist/**', '**/.git/**']

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      defineProject({
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts'],
          exclude,
        },
      }),
      defineProject({
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.e2e.test.ts'],
          exclude,
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
