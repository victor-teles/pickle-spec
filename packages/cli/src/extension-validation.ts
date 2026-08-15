import type { RunExtensionManifest } from '@pickle-spec/runner'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'

function extensionModuleSpecifier(from: string, to: string): string {
  const path = relative(dirname(from), to).replaceAll('\\', '/')
  return path.startsWith('.') ? path : `./${path}`
}

function diagnosticMessage(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
}

function diagnosticReason(diagnostics: readonly ts.Diagnostic[]): string {
  return [...new Set(diagnostics.map(diagnosticMessage))].join('; ')
}

function isRelevantSemanticDiagnostic(
  program: ts.Program,
  diagnostic: ts.Diagnostic,
  validationPath: string,
): boolean {
  if (diagnostic.category !== ts.DiagnosticCategory.Error) return false
  if (diagnostic.code === 2307 && /^Cannot find module '(?:node|bun):/.test(
    diagnosticMessage(diagnostic),
  )) return false
  if (!diagnostic.file) return false
  return resolve(diagnostic.file.fileName) === validationPath
    || !program.isSourceFileFromExternalLibrary(diagnostic.file)
}

function extensionProvidesAdapter(
  typeChecker: ts.TypeChecker,
  defaultExport: ts.Symbol,
  sourceFile: ts.SourceFile,
): boolean {
  const exportedSymbol = defaultExport.flags & ts.SymbolFlags.Alias
    ? typeChecker.getAliasedSymbol(defaultExport)
    : defaultExport
  const declaration = exportedSymbol.valueDeclaration ?? exportedSymbol.declarations?.[0] ?? sourceFile
  const extensionType = typeChecker.getTypeOfSymbolAtLocation(exportedSymbol, declaration)
  const adapter = extensionType.getProperty('adapter')
  const adapterDeclaration = adapter?.valueDeclaration ?? adapter?.declarations?.[0] ?? sourceFile
  const adapterType = adapter && typeChecker.getTypeOfSymbolAtLocation(adapter, adapterDeclaration)

  return Boolean(adapter && !(adapter.flags & ts.SymbolFlags.Optional)
    && adapterType && !(adapterType.flags & ts.TypeFlags.Undefined))
}

export function validateExtensions(path: string): Pick<RunExtensionManifest, 'adapterAvailable'> {
  const validationPath = resolve(import.meta.dir, '__extension_validation__.ts')
  const validationSource = `
import extensions from ${JSON.stringify(extensionModuleSpecifier(validationPath, path))}
import type { Extensions } from './extensions'

type ExpectedExtensions = Extensions
type ExactExtensions<Actual extends ExpectedExtensions> =
  Actual & Record<Exclude<keyof Actual, keyof ExpectedExtensions>, never>
declare function validate<Actual extends ExpectedExtensions>(
  extensions: ExactExtensions<Actual>,
): void
validate(extensions)
`
  const compilerOptions: ts.CompilerOptions = {
    allowImportingTsExtensions: true,
    allowJs: true,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ESNext,
    types: ['bun'],
  }
  const host = ts.createCompilerHost(compilerOptions)
  const getSourceFile = host.getSourceFile.bind(host)
  host.fileExists = fileName => resolve(fileName) === validationPath || ts.sys.fileExists(fileName)
  host.readFile = fileName => resolve(fileName) === validationPath
    ? validationSource
    : ts.sys.readFile(fileName)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (resolve(fileName) === validationPath) {
      return ts.createSourceFile(fileName, validationSource, languageVersion, true, ts.ScriptKind.TS)
    }
    return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
  }

  const program = ts.createProgram([validationPath], compilerOptions, host)
  const syntaxDiagnostics = program.getSyntacticDiagnostics()
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  if (syntaxDiagnostics.length > 0) {
    throw new Error(
      `Cannot validate ${relative(process.cwd(), path)}: ${diagnosticReason(syntaxDiagnostics)}. `
      + 'Fix its imports or syntax and run pickle check again.',
    )
  }

  const typeChecker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(path)
  const moduleSymbol = sourceFile && typeChecker.getSymbolAtLocation(sourceFile)
  const defaultExport = moduleSymbol && typeChecker
    .getExportsOfModule(moduleSymbol)
    .find(symbol => symbol.name === 'default')
  if (!defaultExport) {
    throw new Error(
      `${relative(process.cwd(), path)} must provide a default export. `
      + 'Export the extension object as default and run pickle check again.',
    )
  }

  const semanticDiagnostics = program.getSemanticDiagnostics()
    .filter(diagnostic => isRelevantSemanticDiagnostic(program, diagnostic, validationPath))
  if (semanticDiagnostics.length > 0) {
    const correction = semanticDiagnostics.some(diagnostic =>
      resolve(diagnostic.file?.fileName ?? '') !== validationPath)
      ? 'Fix its imports or syntax and run pickle check again.'
      : 'Correct the extension default export and run pickle check again.'
    throw new Error(
      `Cannot validate ${relative(process.cwd(), path)}: `
      + `${diagnosticReason(semanticDiagnostics)}. ${correction}`,
    )
  }

  return {
    adapterAvailable: extensionProvidesAdapter(typeChecker, defaultExport, sourceFile),
  }
}
