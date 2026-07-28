import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// SEPARATE from vite.config.ts on purpose: vite's own `UserConfigExport` has no `test`
// key, so putting the vitest block in the build config fails `tsc -b` even though the
// test run works. Two files, no triple-slash reference, no type gymnastics.
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom', 'react-router-dom', 'firebase'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
