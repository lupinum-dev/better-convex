import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import ts from 'typescript'

import { resolveArtifactModuleEdge, resolveExactRuntimeModuleEdge } from './purity.mjs'

const MODULE_LINK_DIAGNOSTIC_CODES = new Set([
  1101, // with statements are forbidden in strict modules.
  1192, // Module has no default export.
  1203, // Export assignment cannot be used in an ECMAScript module.
  2300, // Duplicate exported identifier.
  2304, // Export references an unknown local name.
  2305, // Module has no exported member.
  2307, // Relative module target cannot be resolved.
  2308, // Ambiguous star re-export.
  2309, // Export assignment cannot be combined with other exports.
  2323, // Cannot redeclare exported variable.
  2393, // Duplicate function implementation.
  2395, // Merged declarations are inconsistently exported.
  2410, // with statements are unsupported in automatic strict mode.
  2440, // Import declaration conflicts with a local declaration.
  2451, // Cannot redeclare a block-scoped exported variable.
  2459, // Module declares a name locally but does not export it.
  2484, // Export declaration conflicts with another export.
  2498, // export = module cannot be used with export *.
  2528, // Multiple default exports.
  2613, // Module has no default export.
  2614, // Module has no exported member.
  2724, // Module has no exported member (suggested alternative).
  2846, // Declaration imports another declaration with a runtime import form.
])

function createRuntimeCompilerHost(options, artifactRoot, allowExtensionCompletion) {
  const host = ts.createCompilerHost(options, true)
  const cache = ts.createModuleResolutionCache(
    host.getCurrentDirectory(),
    host.getCanonicalFileName,
    options,
  )
  host.getModuleResolutionCache = () => cache
  host.resolveModuleNameLiterals = (
    moduleLiterals,
    containingFile,
    redirectedReference,
    compilerOptions,
    containingSourceFile,
  ) =>
    moduleLiterals.map((literal) => {
      if (
        literal.text.startsWith('.') &&
        isArtifactProgramSource(artifactRoot, containingFile, true)
      ) {
        const resolvedFileName = allowExtensionCompletion
          ? resolveArtifactModuleEdge(artifactRoot, containingFile, literal.text, 'runtime')
          : resolveExactRuntimeModuleEdge(artifactRoot, containingFile, literal.text)
        if (!resolvedFileName) return { resolvedModule: undefined }
        return {
          resolvedModule: {
            extension: resolvedFileName.endsWith('.mjs') ? ts.Extension.Mjs : ts.Extension.Js,
            isExternalLibraryImport: false,
            resolvedFileName,
          },
        }
      }
      return ts.resolveModuleName(
        literal.text,
        containingFile,
        compilerOptions,
        host,
        cache,
        redirectedReference,
        ts.getModeForUsageLocation(containingSourceFile, literal, compilerOptions),
      )
    })
  return host
}

function createArtifactProgram(
  filePaths,
  JavaScript,
  artifactRoot,
  allowExtensionCompletion = false,
) {
  const options = {
    allowJs: JavaScript,
    checkJs: JavaScript,
    module: ts.ModuleKind.NodeNext,
    moduleDetection: ts.ModuleDetectionKind.Force,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    noLib: true,
    skipLibCheck: JavaScript,
    target: ts.ScriptTarget.ESNext,
    types: [],
  }
  return ts.createProgram(
    filePaths,
    options,
    JavaScript
      ? createRuntimeCompilerHost(options, artifactRoot, allowExtensionCompletion)
      : undefined,
  )
}

function isInside(root, filePath) {
  const pathFromRoot = relative(root, filePath)
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  )
}

function isArtifactSource(root, filePath) {
  if (!isInside(root, filePath)) return false
  return !relative(root, filePath).split(sep).includes('node_modules')
}

function isArtifactProgramSource(root, filePath, JavaScript) {
  if (!isArtifactSource(root, filePath)) return false
  return JavaScript
    ? filePath.endsWith('.js') || filePath.endsWith('.mjs')
    : filePath.endsWith('.d.ts') || filePath.endsWith('.d.mts') || filePath.endsWith('.d.cts')
}

function checkExplicitExportSyntax(sourceFile, failures, subpath, artifactRoot) {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && statement.isExportEquals) {
      failures.push(
        `[${subpath}] ${relative(artifactRoot, sourceFile.fileName)} uses unsupported "export =" syntax`,
      )
    } else if (ts.isNamespaceExportDeclaration(statement)) {
      failures.push(
        `[${subpath}] ${relative(artifactRoot, sourceFile.fileName)} uses unsupported "export as namespace" syntax`,
      )
    }
  }
}

function isPublicSurfaceDiagnostic(diagnostic, includeUnresolvedDefaultExport) {
  if (diagnostic.code === 2307) {
    if (!diagnostic.file || diagnostic.start === undefined) return false
    let node = ts.getTokenAtPosition(diagnostic.file, diagnostic.start)
    while (node && !ts.isSourceFile(node)) {
      if (ts.isStringLiteral(node)) return node.text.startsWith('.')
      node = node.parent
    }
    return false
  }
  if (diagnostic.code !== 2304) return MODULE_LINK_DIAGNOSTIC_CODES.has(diagnostic.code)
  if (!diagnostic.file || diagnostic.start === undefined) return false
  const token = ts.getTokenAtPosition(diagnostic.file, diagnostic.start)
  if (includeUnresolvedDefaultExport) {
    let expression = token
    while (
      expression.parent &&
      (ts.isParenthesizedExpression(expression.parent) ||
        ts.isAsExpression(expression.parent) ||
        ts.isNonNullExpression(expression.parent) ||
        ts.isTypeAssertionExpression(expression.parent)) &&
      expression.parent.expression === expression
    ) {
      expression = expression.parent
    }
    if (
      expression.parent &&
      ts.isExportAssignment(expression.parent) &&
      expression.parent.expression === expression
    ) {
      return true
    }
  }
  let node = token
  while (node && !ts.isSourceFile(node)) {
    if (ts.isExportSpecifier(node)) return true
    node = node.parent
  }
  return false
}

function isExplicitTypeOnlyAlias(symbol) {
  const specifiers = (symbol.declarations ?? []).filter(ts.isExportSpecifier)
  return (
    specifiers.length > 0 &&
    specifiers.every(
      (specifier) =>
        specifier.isTypeOnly ||
        (ts.isExportDeclaration(specifier.parent.parent) && specifier.parent.parent.isTypeOnly),
    )
  )
}

function reportProgramDiagnostics(
  program,
  failures,
  scope,
  artifactRoot,
  JavaScript,
  includeUnresolvedDefaultExport = true,
) {
  const acceptsFile = (filePath) => isArtifactProgramSource(artifactRoot, filePath, JavaScript)
  const artifactSourceFiles = program
    .getSourceFiles()
    .filter((candidate) => acceptsFile(candidate.fileName))
  const syntacticByFile = new Map()
  for (const diagnostic of program.getSyntacticDiagnostics()) {
    if (diagnostic.file && !acceptsFile(diagnostic.file.fileName)) continue
    const fileName = diagnostic.file?.fileName ?? '<compiler>'
    const codes = syntacticByFile.get(fileName) ?? new Set()
    codes.add(`TS${diagnostic.code}`)
    syntacticByFile.set(fileName, codes)
  }
  for (const [fileName, codes] of syntacticByFile) {
    failures.push(
      `[${scope}] ${fileName === '<compiler>' ? fileName : relative(artifactRoot, fileName)} has TypeScript parse error(s): ${[...codes].join(', ')}`,
    )
  }
  for (const candidate of artifactSourceFiles) {
    checkExplicitExportSyntax(candidate, failures, scope, artifactRoot)
  }
  const seenSemanticDiagnostics = new Set()
  for (const diagnostic of program.getSemanticDiagnostics()) {
    if (!isPublicSurfaceDiagnostic(diagnostic, includeUnresolvedDefaultExport)) continue
    if (diagnostic.file && !acceptsFile(diagnostic.file.fileName)) continue
    const diagnosticKey = `${diagnostic.file?.fileName ?? '<compiler>'}:${diagnostic.code}`
    if (seenSemanticDiagnostics.has(diagnosticKey)) continue
    seenSemanticDiagnostics.add(diagnosticKey)
    failures.push(
      `[${scope}] ${diagnostic.file ? relative(artifactRoot, diagnostic.file.fileName) : '<compiler>'} has module-link error TS${diagnostic.code}`,
    )
  }
}

export function checkArtifactJavaScriptProgram(filePaths, failures, artifactRoot) {
  artifactRoot = realpathSync(artifactRoot)
  filePaths = filePaths.map((filePath) => realpathSync(filePath))
  const program = createArtifactProgram(filePaths, true, artifactRoot, true)
  reportProgramDiagnostics(program, failures, 'packed JavaScript', artifactRoot, true, true)
}

export function checkArtifactDeclarationProgram(filePaths, failures, artifactRoot) {
  artifactRoot = realpathSync(artifactRoot)
  filePaths = filePaths.map((filePath) => realpathSync(filePath))
  const program = createArtifactProgram(filePaths, false, artifactRoot)
  reportProgramDiagnostics(program, failures, 'packed declarations', artifactRoot, false, true)
}

function getExportSpaces(program, filePath, failures, subpath, artifactRoot) {
  const sourceFile = program.getSourceFile(filePath)
  if (!sourceFile) {
    failures.push(
      `[${subpath}] TypeScript could not load package entry: ${relative(artifactRoot, filePath)}`,
    )
    return null
  }

  const checker = program.getTypeChecker()
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  if (!moduleSymbol) {
    failures.push(`[${subpath}] ${relative(artifactRoot, filePath)} is not an external module`)
    return null
  }

  const names = new Set()
  const values = new Set()
  const types = new Set()
  for (const exportedSymbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = exportedSymbol.getName()
    names.add(name)

    let target = exportedSymbol
    if (exportedSymbol.flags & ts.SymbolFlags.Alias) {
      target = checker.getAliasedSymbol(exportedSymbol)
    }
    const typeOnlyAlias = isExplicitTypeOnlyAlias(exportedSymbol)
    if (!typeOnlyAlias && (target.flags & ts.SymbolFlags.Value) !== 0) values.add(name)
    // The isolated artifact program deliberately does not install sibling
    // packages. An explicit `export type` still proves that the declaration
    // occupies only the type space even when TypeScript cannot resolve its
    // external target in that program.
    if (typeOnlyAlias || (target.flags & ts.SymbolFlags.Type) !== 0) types.add(name)
  }
  return { names, types, values }
}

function assertExactNames(entry, label, actual, expected, failures) {
  const expectedSet = new Set(expected)
  for (const name of expectedSet) {
    if (!actual.has(name)) {
      failures.push(`[${entry.subpath}] ${label} is missing expected export "${name}"`)
    }
  }
  for (const name of actual) {
    if (!expectedSet.has(name)) {
      failures.push(`[${entry.subpath}] ${label} exports unexpected name "${name}"`)
    }
  }
}

function checkEntryExportShapeWithPrograms(
  entry,
  failures,
  artifactRoot,
  runtimeProgram,
  declarationProgram,
) {
  const dtsPath = resolve(artifactRoot, entry.distDts)
  if (!existsSync(dtsPath)) {
    failures.push(`[${entry.subpath}] expected dist file missing: ${entry.distDts}`)
    return
  }

  if (entry.kind === 'runtime') {
    const jsPath = resolve(artifactRoot, entry.distJs)
    if (!existsSync(jsPath)) {
      failures.push(`[${entry.subpath}] expected dist file missing: ${entry.distJs}`)
      return
    }
    const runtimeExports = getExportSpaces(
      runtimeProgram,
      jsPath,
      failures,
      entry.subpath,
      artifactRoot,
    )
    if (runtimeExports) {
      assertExactNames(entry, entry.distJs, runtimeExports.names, entry.valueExports, failures)
    }
  }

  const declarationExports = getExportSpaces(
    declarationProgram,
    dtsPath,
    failures,
    entry.subpath,
    artifactRoot,
  )
  if (!declarationExports) return

  assertExactNames(
    entry,
    `${entry.distDts} value space`,
    declarationExports.values,
    entry.valueExports,
    failures,
  )
  for (const expected of entry.typeExports) {
    if (!declarationExports.types.has(expected)) {
      failures.push(
        `[${entry.subpath}] ${entry.distDts} type space is missing expected export "${expected}"`,
      )
    }
  }

  const expectedDeclared = new Set([...entry.valueExports, ...entry.typeExports])
  for (const expected of expectedDeclared) {
    if (!declarationExports.names.has(expected)) {
      failures.push(
        `[${entry.subpath}] ${entry.distDts} is missing expected declared name "${expected}"`,
      )
    }
  }
  if (entry.exactDeclaredExports) {
    for (const actual of declarationExports.names) {
      if (!expectedDeclared.has(actual)) {
        failures.push(
          `[${entry.subpath}] ${entry.distDts} declares unexpected name "${actual}" (the entry has an exact declaration contract)`,
        )
      }
    }
  }

  for (const forbidden of entry.forbiddenNames) {
    if (declarationExports.names.has(forbidden)) {
      failures.push(`[${entry.subpath}] forbidden export "${forbidden}" is present`)
    }
  }
}

export function checkEntryExportShape(entry, failures, artifactRoot) {
  artifactRoot = realpathSync(artifactRoot)
  const runtimePaths =
    entry.kind === 'runtime' && existsSync(resolve(artifactRoot, entry.distJs))
      ? [resolve(artifactRoot, entry.distJs)]
      : []
  const declarationPaths = existsSync(resolve(artifactRoot, entry.distDts))
    ? [resolve(artifactRoot, entry.distDts)]
    : []
  const runtimeProgram = createArtifactProgram(runtimePaths, true, artifactRoot)
  const declarationProgram = createArtifactProgram(declarationPaths, false, artifactRoot)
  reportProgramDiagnostics(runtimeProgram, failures, entry.subpath, artifactRoot, true)
  reportProgramDiagnostics(declarationProgram, failures, entry.subpath, artifactRoot, false)
  checkEntryExportShapeWithPrograms(
    entry,
    failures,
    artifactRoot,
    runtimeProgram,
    declarationProgram,
  )
}

export function checkEntryExportShapes(entries, failures, artifactRoot) {
  artifactRoot = realpathSync(artifactRoot)
  const runtimePaths = entries
    .filter((entry) => entry.kind === 'runtime')
    .map((entry) => resolve(artifactRoot, entry.distJs))
    .filter(existsSync)
  const declarationPaths = entries
    .map((entry) => resolve(artifactRoot, entry.distDts))
    .filter(existsSync)
  const runtimeProgram = createArtifactProgram(runtimePaths, true, artifactRoot)
  const declarationProgram = createArtifactProgram(declarationPaths, false, artifactRoot)
  reportProgramDiagnostics(runtimeProgram, failures, 'package runtime graph', artifactRoot, true)
  reportProgramDiagnostics(
    declarationProgram,
    failures,
    'package declaration graph',
    artifactRoot,
    false,
  )
  for (const entry of entries) {
    checkEntryExportShapeWithPrograms(
      entry,
      failures,
      artifactRoot,
      runtimeProgram,
      declarationProgram,
    )
  }
}
