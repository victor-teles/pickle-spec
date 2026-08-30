import { resolve } from 'node:path'

const docsRoot = resolve(import.meta.dir, '..')
const requiredPages = [
  'content/docs/index.mdx',
  'content/docs/web/quick-start.mdx',
  'content/docs/web/scenarios.mdx',
  'content/docs/concepts/syntax.mdx',
  'content/docs/concepts/how-it-works.mdx',
  'content/docs/native/index.mdx',
  'content/docs/native/android.mdx',
  'content/docs/native/ios.mdx',
]

for (const page of requiredPages) {
  if (!(await Bun.file(resolve(docsRoot, page)).exists())) {
    throw new Error(`Missing required docs page: ${page}`)
  }
}

const quickStart = await Bun.file(
  resolve(docsRoot, 'content/docs/web/quick-start.mdx'),
).text()
for (const requiredText of [
  'pickle init',
  'examples/web-quick-start/pickle.config.jsonc',
  'examples/web-quick-start/features/example.feature',
  'bunx pickle check',
  'bunx pickle run --profile web',
]) {
  if (!quickStart.includes(requiredText)) {
    throw new Error(`Web quick start is missing: ${requiredText}`)
  }
}

const exampleConfig = await Bun.file(
  resolve(docsRoot, 'examples/web-quick-start/pickle.config.jsonc'),
).text()
if (!exampleConfig.includes('"executionTargetProfiles"')) {
  throw new Error(
    'Web quick-start config must use named execution target profiles',
  )
}

const exampleFeature = await Bun.file(
  resolve(docsRoot, 'examples/web-quick-start/features/example.feature'),
).text()
if (!exampleFeature.includes('@pickle:state:active')) {
  throw new Error('Web quick-start Feature must declare the active state')
}

const cliPath = resolve(docsRoot, '../../packages/cli/src/cli.ts')
const exampleRoot = resolve(docsRoot, 'examples/web-quick-start')
const checked = Bun.spawnSync({
  cmd: [process.execPath, cliPath, 'check'],
  cwd: exampleRoot,
  env: Bun.env,
  stdout: 'pipe',
  stderr: 'pipe',
})

if (checked.exitCode !== 0) {
  throw new Error(checked.stderr.toString() || checked.stdout.toString())
}

console.log(checked.stdout.toString().trim())
console.log(`Verified ${requiredPages.length} documentation pages`)
