import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

const watch = process.argv.includes('--watch')

await build({
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  target: 'es2022',
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  format: 'esm',
  platform: 'node',
  // schemastery 一并打包：lib 完全自包含，任何安装方式（github:/tarball/目录）都不再装运行时依赖
  external: ['node:*'],
  jsx: 'automatic',
  ...(watch ? { watch: true } : {}),
})

// client/index.js 是手写的静态客户端模块（__ModuleLoader__ 约定），不参与 esbuild 构建
console.log('build done')
