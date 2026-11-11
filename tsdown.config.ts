import { defineConfig } from 'tsdown';

// Entry map matches package.json "exports":
//   .           → dist/index.js
//   ./react     → dist/react/index.js
//   ./audit     → dist/with-audit.js
//   ./fonts     → dist/fonts.js
//   ./recipes   → dist/templates/index.js
//   ./kit       → dist/react/kit.js
//
// NOTE: ./kit source is src/kit.ts (not src/react/kit.ts).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.ts',
    'with-audit': 'src/with-audit.ts',
    fonts: 'src/fonts.ts',
    'templates/index': 'src/templates/index.ts',
    'react/kit': 'src/kit.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: true,
  sourcemap: true,
  clean: true,
  // tsdown 0.21+: external → deps.neverBundle
  // https://tsdown.dev/options/dependencies
  deps: {
    neverBundle: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@takumi-rs/helpers',
      '@takumi-rs/helpers/jsx',
      '@takumi-rs/helpers/html',
      '@takumi-rs/core',
      'tsx',
    ],
  },
});
