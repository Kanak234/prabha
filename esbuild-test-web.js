const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['tests/web/activation-test.js'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'out/web-activation-test.js',
  define: {
    'process.env': '{}'
  },
  alias: {
    'assert': './lib/assert-polyfill.js',
    'fs': './lib/fs-polyfill.js',
    'path': './lib/path-polyfill.js'
  }
}).catch(() => process.exit(1));
