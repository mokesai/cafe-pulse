import { defineConfig } from 'vitest/config'
import path from 'path'

const alias = { '@': path.resolve(__dirname, './src') }

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            '__tests__/**/*.test.ts',
            'src/**/*.test.ts',
            'src/**/__tests__/**/*.test.ts',
          ],
          exclude: [
            'node_modules/**',
            'dist/**',
            '.next/**',
            'supabase/functions/**',
            'tests/**',
          ],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['node_modules/**', 'dist/**', '.next/**'],
          testTimeout: 30_000,
          // cleanupTenant runs ~50 DELETEs per tenant; the inventory test
          // creates ~7 tenants worth of fixtures via createInventoryItem and
          // tears them down in afterAll. Default 10s hook timeout is too tight.
          hookTimeout: 60_000,
          setupFiles: ['tests/integration/setup.ts'],
        },
      },
    ],
  },
})
