import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import ts from 'typescript'

const COMPUTED_DYNAMIC_IMPORT = '<computed dynamic import>'
const runtimeExtensions = ['.js', '.mjs']
const declarationExtensions = ['.d.ts', '.d.mts', '.d.cts']
const typescriptLibDirectory = dirname(ts.getDefaultLibFilePath({}))
const moduleLoaderNames = new Set([
  'require',
  'createRequire',
  'getBuiltinModule',
  'eval',
  'Function',
])

function parseSource(filePath) {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.cjs')
      ? ts.ScriptKind.JS
      : filePath.endsWith('.js') || filePath.endsWith('.mjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS,
  )
}

function collectImportSpecifiers(sourceFile) {
  const specifiers = []
  function moduleLoaderName(expression) {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isNonNullExpression(expression)
    ) {
      return moduleLoaderName(expression.expression)
    }
    if (ts.isIdentifier(expression) && moduleLoaderNames.has(expression.text)) {
      return expression.text
    }
    if (ts.isPropertyAccessExpression(expression)) {
      if (moduleLoaderNames.has(expression.name.text)) return expression.name.text
      return moduleLoaderName(expression.expression)
    }
    if (
      ts.isElementAccessExpression(expression) &&
      expression.argumentExpression &&
      ts.isStringLiteral(expression.argumentExpression) &&
      moduleLoaderNames.has(expression.argumentExpression.text)
    ) {
      return expression.argumentExpression.text
    }
    if (ts.isCallExpression(expression)) return moduleLoaderName(expression.expression)
    return null
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifiers.push(
        node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
          ? node.arguments[0].text
          : COMPUTED_DYNAMIC_IMPORT,
      )
    } else if (ts.isCallExpression(node)) {
      const loader = moduleLoaderName(node.expression)
      if (loader) specifiers.push(`<unsupported module loader: ${loader}>`)
    } else if (ts.isNewExpression(node)) {
      const loader = moduleLoaderName(node.expression)
      if (loader) specifiers.push(`<unsupported module loader: ${loader}>`)
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function parseDiagnosticCodes(sourceFile) {
  const diagnostics = [...(sourceFile.parseDiagnostics ?? [])]
  if (sourceFile.fileName.endsWith('.js') || sourceFile.fileName.endsWith('.mjs')) {
    diagnostics.push(
      ...(ts.transpileModule(sourceFile.text, {
        fileName: sourceFile.fileName,
        reportDiagnostics: true,
        compilerOptions: {
          allowJs: true,
          checkJs: true,
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          noEmit: true,
          target: ts.ScriptTarget.ESNext,
        },
      }).diagnostics ?? []),
    )
  }
  return [...new Set(diagnostics.map((diagnostic) => `TS${diagnostic.code}`))]
}

export function inspectModuleFile(filePath) {
  const sourceFile = parseSource(filePath)
  return {
    diagnosticCodes: parseDiagnosticCodes(sourceFile),
    sourceFile,
    specifiers: collectImportSpecifiers(sourceFile),
  }
}

export function isKnownTypeScriptLibReference(reference) {
  return (
    /^[a-z0-9][a-z0-9.-]*$/u.test(reference) &&
    existsSync(resolve(typescriptLibDirectory, `lib.${reference}.d.ts`))
  )
}

function staysInside(root, target) {
  const pathFromRoot = relative(root, target)
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  )
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile()
}

function resolveCanonicalRelativeTarget(importingFile, specifier) {
  if (specifier.includes('\\') || /[%?#]/u.test(specifier)) return null
  try {
    return fileURLToPath(new URL(specifier, pathToFileURL(importingFile)))
  } catch {
    return null
  }
}

function runtimeCandidates(importingFile, specifier, allowExtensionCompletion) {
  const target = resolveCanonicalRelativeTarget(importingFile, specifier)
  if (!target) return []
  if (target.endsWith('.cjs')) return []
  if (
    !allowExtensionCompletion &&
    !runtimeExtensions.some((extension) => target.endsWith(extension))
  ) {
    return []
  }
  const candidates = [target]
  if (
    allowExtensionCompletion &&
    !runtimeExtensions.some((extension) => target.endsWith(extension))
  ) {
    for (const extension of runtimeExtensions) candidates.push(`${target}${extension}`)
    for (const extension of runtimeExtensions) candidates.push(resolve(target, `index${extension}`))
  }
  return candidates
}

function declarationCandidates(importingFile, specifier, allowExtensionCompletion) {
  const target = resolveCanonicalRelativeTarget(importingFile, specifier)
  if (!target) return []
  if (declarationExtensions.some((extension) => target.endsWith(extension))) {
    return [target]
  }
  const emittedExtensionMap = [
    ['.mjs', '.d.mts'],
    ['.cjs', '.d.cts'],
    ['.js', '.d.ts'],
  ]
  for (const [runtimeExtension, declarationExtension] of emittedExtensionMap) {
    if (target.endsWith(runtimeExtension)) {
      return [`${target.slice(0, -runtimeExtension.length)}${declarationExtension}`]
    }
  }
  if (!allowExtensionCompletion) return []
  return [
    ...declarationExtensions.map((extension) => `${target}${extension}`),
    ...declarationExtensions.map((extension) => resolve(target, `index${extension}`)),
  ]
}

function referencePathCandidates(importingFile, specifier) {
  if (specifier.length === 0) return []
  const target = resolveCanonicalRelativeTarget(importingFile, specifier)
  if (!target) return []
  if (declarationExtensions.some((extension) => target.endsWith(extension))) {
    return [target]
  }
  if (/\.[^/]+$/u.test(target)) return []
  return declarationExtensions.map((extension) => `${target}${extension}`)
}

function resolveCandidate(packageRoot, candidates) {
  for (const candidate of candidates) {
    if (!staysInside(packageRoot, candidate) || !isFile(candidate)) continue
    const canonical = realpathSync(candidate)
    if (staysInside(packageRoot, canonical)) return canonical
  }
  return null
}

function resolveLocalEdge(
  packageRoot,
  importingFile,
  specifier,
  graphKind,
  allowExtensionCompletion,
) {
  const candidates =
    graphKind === 'runtime'
      ? runtimeCandidates(importingFile, specifier, allowExtensionCompletion)
      : declarationCandidates(importingFile, specifier, allowExtensionCompletion)
  return resolveCandidate(packageRoot, candidates)
}

export function resolveArtifactModuleEdge(packageRoot, importingFile, specifier, graphKind) {
  if (graphKind !== 'runtime' && graphKind !== 'types') {
    throw new TypeError(`Unknown artifact module graph kind: ${graphKind}`)
  }
  return resolveLocalEdge(
    realpathSync(packageRoot),
    realpathSync(importingFile),
    specifier,
    graphKind,
    true,
  )
}

export function resolveExactRuntimeModuleEdge(packageRoot, importingFile, specifier) {
  return resolveLocalEdge(
    realpathSync(packageRoot),
    realpathSync(importingFile),
    specifier,
    'runtime',
    false,
  )
}

export function resolveArtifactReferencePathEdge(packageRoot, importingFile, specifier) {
  return resolveCandidate(
    realpathSync(packageRoot),
    referencePathCandidates(realpathSync(importingFile), specifier),
  )
}

function walkEntryGraph(entry, packageRoot, graphKind, entryPath, failures, inspectionCache) {
  const observedExternalSpecifiers = new Set()
  const visited = new Set()
  const queue = [resolve(packageRoot, entryPath)]

  while (queue.length > 0) {
    const requestedPath = queue.shift()
    if (!staysInside(packageRoot, requestedPath) || !isFile(requestedPath)) {
      failures.push(
        `[${entry.subpath}] ${graphKind} entry graph is missing package file: ${entryPath}`,
      )
      continue
    }
    const next = realpathSync(requestedPath)
    if (!staysInside(packageRoot, next)) {
      failures.push(
        `[${entry.subpath}] ${graphKind} entry graph resolves outside the package: ${entryPath}`,
      )
      continue
    }
    if (visited.has(next)) continue
    visited.add(next)

    let inspection
    try {
      inspection = inspectionCache.get(next)
      if (!inspection) {
        inspection = inspectModuleFile(next)
        inspectionCache.set(next, inspection)
      }
    } catch (error) {
      failures.push(
        `[${entry.subpath}] failed to parse ${relative(packageRoot, next)}: ${error.message}`,
      )
      continue
    }

    const { diagnosticCodes, sourceFile, specifiers } = inspection
    if (diagnosticCodes.length > 0) {
      failures.push(
        `[${entry.subpath}] ${relative(packageRoot, next)} has TypeScript parse error(s): ${diagnosticCodes.join(', ')}`,
      )
      continue
    }

    if (graphKind === 'types') {
      for (const directive of sourceFile.typeReferenceDirectives) {
        specifiers.push(directive.fileName)
      }
      for (const directive of sourceFile.libReferenceDirectives) {
        if (!isKnownTypeScriptLibReference(directive.fileName)) {
          failures.push(
            `[${entry.subpath}] ${relative(packageRoot, next)} has unknown TypeScript lib reference "${directive.fileName}"`,
          )
        }
      }
    }

    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) {
        observedExternalSpecifiers.add(specifier)
        continue
      }
      const resolvedEdge = resolveLocalEdge(packageRoot, next, specifier, graphKind, false)
      if (!resolvedEdge) {
        failures.push(
          `[${entry.subpath}] ${relative(packageRoot, next)} has unresolved ${graphKind} edge "${specifier}"`,
        )
        continue
      }
      if (!visited.has(resolvedEdge)) queue.push(resolvedEdge)
    }

    if (graphKind === 'types') {
      for (const directive of sourceFile.referencedFiles) {
        const resolvedEdge = resolveArtifactReferencePathEdge(packageRoot, next, directive.fileName)
        if (!resolvedEdge) {
          failures.push(
            `[${entry.subpath}] ${relative(packageRoot, next)} has unresolved types reference path "${directive.fileName}"`,
          )
          continue
        }
        if (!visited.has(resolvedEdge)) queue.push(resolvedEdge)
      }
    }
  }

  return observedExternalSpecifiers
}

export function collectDeclarationExternalSpecifiers(
  entryPath,
  failures,
  artifactRoot,
  subpath = '.',
) {
  return walkEntryGraph(
    { subpath },
    realpathSync(artifactRoot),
    'types',
    entryPath,
    failures,
    new Map(),
  )
}

function assertExactExternalSpecifiers(entry, graphKind, observed, expected, failures) {
  const expectedSet = new Set(expected)
  for (const specifier of observed) {
    if (!expectedSet.has(specifier)) {
      failures.push(
        `[${entry.subpath}] ${graphKind} graph imports unreviewed external specifier "${specifier}"`,
      )
    }
  }
  for (const specifier of expectedSet) {
    if (!observed.has(specifier)) {
      failures.push(
        `[${entry.subpath}] ${graphKind} graph no longer imports reviewed external specifier "${specifier}"; remove the stale allowance`,
      )
    }
  }
}

function checkEntryPurityWithCache(entry, failures, artifactRoot, inspectionCache) {
  const packageRoot = realpathSync(artifactRoot)

  const observedRuntime =
    entry.kind === 'runtime'
      ? walkEntryGraph(entry, packageRoot, 'runtime', entry.distJs, failures, inspectionCache)
      : new Set()
  const observedTypes = walkEntryGraph(
    entry,
    packageRoot,
    'types',
    entry.distDts,
    failures,
    inspectionCache,
  )

  assertExactExternalSpecifiers(
    entry,
    'runtime',
    observedRuntime,
    entry.purity.runtimeExternalSpecifiers,
    failures,
  )
  assertExactExternalSpecifiers(
    entry,
    'types',
    observedTypes,
    entry.purity.typeExternalSpecifiers,
    failures,
  )
}

export function checkEntryPurity(entry, failures, artifactRoot) {
  checkEntryPurityWithCache(entry, failures, artifactRoot, new Map())
}

export function checkEntryPurities(entries, failures, artifactRoot) {
  const inspectionCache = new Map()
  for (const entry of entries) {
    checkEntryPurityWithCache(entry, failures, artifactRoot, inspectionCache)
  }
}
