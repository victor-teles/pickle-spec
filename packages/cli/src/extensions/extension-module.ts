import { readFileSync, statSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '@typescript/typescript6'
import { extensionsSchema, type Extensions } from './extensions'

const extensionModules = new Set<string>()
let hooksInstalled = false

function isProjectModule(url: string): boolean {
  return (
    url.startsWith('file:') &&
    !fileURLToPath(url).split(/[\\/]/).includes('node_modules')
  )
}

function resolvedProjectImport(specifier: string, parentURL: string): string {
  if (!specifier.startsWith('.')) return specifier
  const url = new URL(specifier, parentURL)
  if (extname(url.pathname)) return specifier
  for (const suffix of [
    '.ts',
    '.mts',
    '.tsx',
    '.js',
    '/index.ts',
    '/index.js',
  ]) {
    const candidate = new URL(`${url.href}${suffix}`)
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile())
      return candidate.href
  }
  return specifier
}

function installExtensionHooks(): void {
  // Runtimes with native TypeScript loading can import extensions directly.
  if (hooksInstalled || !('registerHooks' in nodeModule)) return
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!context.parentURL || !extensionModules.has(context.parentURL)) {
        return nextResolve(specifier, context)
      }
      const result = nextResolve(
        resolvedProjectImport(specifier, context.parentURL),
        context,
      )
      if (isProjectModule(result.url)) extensionModules.add(result.url)
      return result
    },
    load(url, context, nextLoad) {
      if (
        !extensionModules.has(url) ||
        !/\.[cm]?tsx?$/.test(new URL(url).pathname)
      ) {
        return nextLoad(url, context)
      }
      const fileName = fileURLToPath(url)
      const commonJs = fileName.endsWith('.cts')
      const compiled = ts.transpileModule(readFileSync(fileName, 'utf8'), {
        fileName,
        compilerOptions: {
          module: commonJs ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ESNext,
          inlineSourceMap: true,
          inlineSources: true,
        },
      })
      return {
        format: commonJs ? 'commonjs' : 'module',
        source: compiled.outputText,
        shortCircuit: true,
      }
    },
  })
  hooksInstalled = true
}

export async function loadExtensionModule(url: URL): Promise<Extensions> {
  extensionModules.add(url.href)
  installExtensionHooks()
  const imported = await import(url.href)
  return extensionsSchema.parse(imported.default ?? {})
}
