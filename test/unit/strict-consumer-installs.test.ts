import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = new URL('../..', import.meta.url)
const scriptsRoot = new URL('../../scripts/', import.meta.url)

function scriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return scriptFiles(path)
    return entry.isFile() && entry.name.endsWith('.mjs') ? [path] : []
  })
}

describe('isolated pnpm consumer installs', () => {
  it('always fails closed on peer dependency issues', () => {
    const violations: string[] = []

    for (const path of scriptFiles(scriptsRoot.pathname)) {
      const source = readFileSync(path, 'utf8')
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        if (
          ts.isArrayLiteralExpression(node) &&
          node.elements.some(
            (element, index) =>
              index === 0 && ts.isStringLiteral(element) && element.text === 'install',
          ) &&
          node.parent.parent &&
          ts.isVariableDeclaration(node.parent.parent) &&
          ts.isIdentifier(node.parent.parent.name) &&
          node.parent.parent.name.text === 'installArgs'
        ) {
          const args = node.elements.filter(ts.isStringLiteral).map((element) => element.text)
          if (!args.includes('--strict-peer-dependencies')) {
            const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1
            violations.push(`${path.slice(root.pathname.length)}:${line}`)
          }
        }
        if (ts.isCallExpression(node)) {
          const command = node.arguments.at(0)
          const arguments_ = node.arguments.at(1)
          if (
            command &&
            arguments_ &&
            ts.isStringLiteral(command) &&
            command.text === 'pnpm' &&
            ts.isArrayLiteralExpression(arguments_)
          ) {
            const args = arguments_.elements
              .filter(ts.isStringLiteral)
              .map((element) => element.text)
            if (args[0] === 'install' && !args.includes('--strict-peer-dependencies')) {
              const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1
              violations.push(`${path.slice(root.pathname.length)}:${line}`)
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
    }

    expect(violations).toEqual([])
  })
})
