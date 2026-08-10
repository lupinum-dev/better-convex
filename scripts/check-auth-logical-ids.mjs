#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

import { getMaintainedCandidateProfile } from './maintained-candidate-apps.mjs'

const root = resolve(import.meta.dirname, '..')
const { profile: maintainedCandidateProfile } = getMaintainedCandidateProfile('nuxt')
export const maintainedAuthConsumerRoots = [
  'src/runtime/convex-auth/user-projection.ts',
  'playground/convex',
  ...maintainedCandidateProfile.pnpmApps.map(({ path }) => `${path}/convex`),
  'test/fixtures/better-auth-local-component/convex',
]
const queryFactories = new Set(['internalQuery', 'query', 'queryGeneric'])
const forbiddenQueryMethods = new Set(['getAuth', 'getHeaders'])
const triggerNames = new Set(['onCreate', 'onDelete', 'onUpdate'])

function propertyName(node) {
  if (!node) return undefined
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return undefined
}

function sourceLine(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function isBetterAuthType(node, sourceFile) {
  return node ? /\b(?:BetterAuth\w*|TAuthUser)\b/.test(node.getText(sourceFile)) : false
}

function isBetterAuthAdapterCall(node, sourceFile) {
  return (
    ts.isCallExpression(node) &&
    /\bcomponents\.betterAuth\.adapter\./.test(node.getText(sourceFile))
  )
}

function isAuthUserCall(node, sourceFile) {
  return (
    ts.isCallExpression(node) &&
    /\bauthComponent\.(?:getAuthUser|safeGetAuthUser)\b/.test(node.expression.getText(sourceFile))
  )
}

function unwrapExpression(node) {
  let current = node
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function authRowIdentifiers(sourceFile) {
  const names = new Set()

  function visit(node) {
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      isBetterAuthType(node.type, sourceFile)
    ) {
      names.add(node.name.text)
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      (isBetterAuthType(node.type, sourceFile) ||
        (node.initializer &&
          (isBetterAuthAdapterCall(unwrapExpression(node.initializer), sourceFile) ||
            isAuthUserCall(unwrapExpression(node.initializer), sourceFile))))
    ) {
      names.add(node.name.text)
    }
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      isBetterAuthType(node.type, sourceFile)
    ) {
      names.add(node.expression.text)
    }
    if (
      (ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) &&
      triggerNames.has(propertyName(node.name) ?? '')
    ) {
      const callback = ts.isPropertyAssignment(node) ? node.initializer : node
      if (
        ts.isArrowFunction(callback) ||
        ts.isFunctionExpression(callback) ||
        ts.isMethodDeclaration(callback)
      ) {
        for (const parameter of callback.parameters.slice(1)) {
          if (ts.isIdentifier(parameter.name)) names.add(parameter.name.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

function queryHandlerViolations(sourceFile, report) {
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      queryFactories.has(node.expression.text)
    ) {
      const config = node.arguments[0]
      if (config && ts.isObjectLiteralExpression(config)) {
        const handlerProperty = config.properties.find(
          (property) => propertyName(property.name) === 'handler',
        )
        const handler =
          handlerProperty && ts.isPropertyAssignment(handlerProperty)
            ? handlerProperty.initializer
            : handlerProperty && ts.isMethodDeclaration(handlerProperty)
              ? handlerProperty
              : undefined
        if (handler) {
          function inspectHandler(child) {
            if (
              ts.isCallExpression(child) &&
              ts.isPropertyAccessExpression(child.expression) &&
              ts.isIdentifier(child.expression.expression) &&
              child.expression.expression.text === 'authComponent' &&
              forbiddenQueryMethods.has(child.expression.name.text)
            ) {
              report(child, `query handler calls authComponent.${child.expression.name.text}()`)
            }
            ts.forEachChild(child, inspectHandler)
          }
          inspectHandler(handler)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

export function scanAuthLogicalIdSource(source, filename = 'fixture.ts') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const violations = []
  const authIdentifiers = authRowIdentifiers(sourceFile)
  const report = (node, message) => violations.push({ line: sourceLine(sourceFile, node), message })

  function visit(node) {
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      node.name.text.startsWith('BetterAuth')
    ) {
      function inspectType(child) {
        if (
          (ts.isPropertySignature(child) || ts.isPropertyDeclaration(child)) &&
          propertyName(child.name) === '_id'
        ) {
          report(child, `${node.name.text} exposes Convex _id`)
        }
        ts.forEachChild(child, inspectType)
      }
      inspectType(node)
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === '_id' &&
      ts.isIdentifier(node.expression) &&
      authIdentifiers.has(node.expression.text)
    ) {
      report(node, `Better Auth row ${node.expression.text} uses Convex _id`)
    }

    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === 'authId' &&
      ts.isPropertyAccessExpression(node.initializer) &&
      node.initializer.name.text === '_id'
    ) {
      report(node, 'auth projection is populated from Convex _id')
    }

    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
        node.operatorToken.kind,
      )
    ) {
      const left = unwrapExpression(node.left)
      const right = unwrapExpression(node.right)
      if (
        ts.isPropertyAccessExpression(left) &&
        ts.isPropertyAccessExpression(right) &&
        left.expression.getText(sourceFile) === right.expression.getText(sourceFile) &&
        new Set([left.name.text, right.name.text]).size === 2 &&
        [left.name.text, right.name.text].every((name) => name === 'id' || name === '_id')
      ) {
        report(node, 'logical id falls back to Convex _id')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  queryHandlerViolations(sourceFile, report)
  return violations
}

function collectFiles(entry) {
  const absolute = resolve(root, entry)
  if (entry.endsWith('.ts')) return [absolute]
  const files = []
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name)
      if (item.isDirectory()) {
        if (!['_generated', 'node_modules'].includes(item.name)) walk(path)
      } else if (item.isFile() && /\.(?:ts|tsx)$/.test(item.name)) {
        files.push(path)
      }
    }
  }
  walk(absolute)
  return files
}

export function scanMaintainedAuthConsumers() {
  const violations = []
  for (const filename of maintainedAuthConsumerRoots.flatMap(collectFiles).sort()) {
    const source = readFileSync(filename, 'utf8')
    for (const violation of scanAuthLogicalIdSource(source, filename)) {
      violations.push({
        ...violation,
        file: relative(root, filename).split(sep).join('/'),
      })
    }
  }
  return violations
}

function main() {
  const violations = scanMaintainedAuthConsumers()
  if (violations.length > 0) {
    console.error(`Auth logical-ID boundary failed in ${violations.length} location(s):`)
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line} ${violation.message}`)
    }
    process.exitCode = 1
    return
  }
  console.log('Auth logical-ID and query-context boundary passed.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
