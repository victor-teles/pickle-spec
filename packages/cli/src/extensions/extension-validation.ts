import { dirname, relative, resolve } from 'node:path'
import type { RunExtensionManifest } from '@pickle-spec/runner'
// TypeScript 7 has no compiler API yet; keep 6.x for extension type-checking.
import ts from '@typescript/typescript6'

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
  if (
    diagnostic.code === 2307 &&
    /^Cannot find module '(?:node|bun):/.test(diagnosticMessage(diagnostic))
  )
    return false
  if (!diagnostic.file) return false
  return (
    resolve(diagnostic.file.fileName) === validationPath ||
    !program.isSourceFileFromExternalLibrary(diagnostic.file)
  )
}

function requiredExtensionPropertyType(
  typeChecker: ts.TypeChecker,
  parent: ts.Type,
  name: string,
  sourceFile: ts.SourceFile,
): ts.Type | undefined {
  const property = parent.getProperty(name)
  if (!property || property.flags & ts.SymbolFlags.Optional) return undefined
  const declaration =
    property.valueDeclaration ?? property.declarations?.[0] ?? sourceFile
  const type = typeChecker.getTypeOfSymbolAtLocation(property, declaration)
  if (type.flags & ts.TypeFlags.Undefined) return undefined
  return type
}

function extensionProvidesAdapter(
  typeChecker: ts.TypeChecker,
  defaultExport: ts.Symbol,
  sourceFile: ts.SourceFile,
): boolean {
  const exportedSymbol =
    defaultExport.flags & ts.SymbolFlags.Alias
      ? typeChecker.getAliasedSymbol(defaultExport)
      : defaultExport
  const declaration =
    exportedSymbol.valueDeclaration ??
    exportedSymbol.declarations?.[0] ??
    sourceFile
  const extensionType = typeChecker.getTypeOfSymbolAtLocation(
    exportedSymbol,
    declaration,
  )
  const adaptersType = requiredExtensionPropertyType(
    typeChecker,
    extensionType,
    'adapters',
    sourceFile,
  )
  return Boolean(
    requiredExtensionPropertyType(
      typeChecker,
      extensionType,
      'adapter',
      sourceFile,
    ) ||
      adaptersType
        ?.getProperties()
        .some((property) => property.name !== '__index'),
  )
}

function extensionValidationSource(validationPath: string, path: string) {
  return `
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
}

function extensionValidationProgram(
  validationPath: string,
  validationSource: string,
): ts.Program {
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
  const isValidationFile = (fileName: string) =>
    resolve(fileName) === validationPath
  host.fileExists = (fileName) =>
    isValidationFile(fileName) || ts.sys.fileExists(fileName)
  host.readFile = (fileName) =>
    isValidationFile(fileName) ? validationSource : ts.sys.readFile(fileName)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    isValidationFile(fileName)
      ? ts.createSourceFile(
          fileName,
          validationSource,
          languageVersion,
          true,
          ts.ScriptKind.TS,
        )
      : getSourceFile(fileName, languageVersion, onError, shouldCreate)
  return ts.createProgram([validationPath], compilerOptions, host)
}

function throwExtensionDiagnostics(
  path: string,
  diagnostics: readonly ts.Diagnostic[],
  correction: string,
): void {
  if (diagnostics.length === 0) return
  throw new Error(
    `Cannot validate ${relative(process.cwd(), path)}: ` +
      `${diagnosticReason(diagnostics)}. ${correction}`,
  )
}

export function validateExtensions(
  path: string,
): Pick<RunExtensionManifest, 'adapterAvailable'> {
  const validationPath = resolve(import.meta.dir, '__extension_validation__.ts')
  const program = extensionValidationProgram(
    validationPath,
    extensionValidationSource(validationPath, path),
  )
  const syntaxDiagnostics = program
    .getSyntacticDiagnostics()
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  throwExtensionDiagnostics(
    path,
    syntaxDiagnostics,
    'Fix its imports or syntax and run pickle check again.',
  )

  const typeChecker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(path)
  const moduleSymbol = sourceFile && typeChecker.getSymbolAtLocation(sourceFile)
  const defaultExport =
    moduleSymbol &&
    typeChecker
      .getExportsOfModule(moduleSymbol)
      .find((symbol) => symbol.name === 'default')
  if (!defaultExport) {
    throw new Error(
      `${relative(process.cwd(), path)} must provide a default export. ` +
        'Export the extension object as default and run pickle check again.',
    )
  }

  const semanticDiagnostics = program
    .getSemanticDiagnostics()
    .filter((diagnostic) =>
      isRelevantSemanticDiagnostic(program, diagnostic, validationPath),
    )
  const importedSourceFailed = semanticDiagnostics.some(
    (diagnostic) => resolve(diagnostic.file?.fileName ?? '') !== validationPath,
  )
  throwExtensionDiagnostics(
    path,
    semanticDiagnostics,
    importedSourceFailed
      ? 'Fix its imports or syntax and run pickle check again.'
      : 'Correct the extension default export and run pickle check again.',
  )

  return {
    adapterAvailable: extensionProvidesAdapter(
      typeChecker,
      defaultExport,
      sourceFile,
    ),
  }
}
