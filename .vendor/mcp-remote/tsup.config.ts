import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/client.ts', 'src/proxy.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  // external: ['typescript'],
})
