import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Library build: one ES module, three.js left to the consumer (peer
// dependency). The Sound System model is inlined, so the package works
// with any bundler without extra asset config.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'threejs-visualisers',
    },
    rollupOptions: {
      external: (id) => id === 'three' || id.startsWith('three/'),
    },
    assetsInlineLimit: Infinity,
  },
})
