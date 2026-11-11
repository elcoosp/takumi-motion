import { defineConfig } from 'tsdown';

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
  // Force .js/.d.ts extensions so they match package.json "exports"
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
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
