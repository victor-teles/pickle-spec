import { spawnSync } from 'node:child_process'
import { chmod, glob, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = process.cwd()
const output = resolve(root, 'lib')
await rm(output, { recursive: true, force: true })
const compiled = spawnSync(
  'bunx',
  ['tsc', '--project', 'tsconfig.build.json'],
  {
    cwd: root,
    stdio: 'inherit',
  },
)
if (compiled.status !== 0) process.exit(compiled.status ?? 1)

function modulePath(file: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  if (/\.[cm]?tsx?$/.test(specifier))
    return specifier.replace(/\.[cm]?tsx?$/, '.js')
  if (/\.(?:[cm]?js|json|css|svg|png|wasm)$/i.test(specifier)) return specifier
  return existsSync(resolve(dirname(file), `${specifier}.js`)) ||
    existsSync(resolve(dirname(file), `${specifier}.d.ts`))
    ? `${specifier}.js`
    : `${specifier}/index.js`
}

for await (const relativePath of glob('**/*.{js,ts}', { cwd: output })) {
  const file = resolve(output, relativePath)
  const source = await readFile(file, 'utf8')
  const rewritten = source.replace(
    /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"])(\.[^'"]+)(['"])/g,
    (_match, prefix: string, specifier: string, suffix: string) =>
      `${prefix}${modulePath(file, specifier)}${suffix}`,
  )
  if (source !== rewritten) await writeFile(file, rewritten)
}
if (existsSync(resolve(output, 'src/cli.js'))) {
  await chmod(resolve(output, 'src/cli.js'), 0o755)
}
