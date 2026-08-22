#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { runAuthSchemaCommand } from './auth-schema'
import { runConvexCommand } from './convex'
import { runInitCommand } from './init'

function usage(): string {
  return [
    'Better Convex project tooling.',
    '',
    'Usage:',
    '  better-convex init',
    '  better-convex convex <command> [options]',
    '  better-convex auth schema --config <schema-options.ts> [options]',
    '  better-convex --version',
  ].join('\n')
}

function packageVersion(): string {
  const manifestPath = fileURLToPath(new URL('../../../package.json', import.meta.url))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('The installed package has no valid version.')
  }
  return manifest.version
}

export async function runBetterConvexCommand(arguments_: readonly string[]): Promise<number> {
  const [command, subcommand, ...rest] = arguments_
  if (!command || command === '--help' || command === '-h') {
    console.log(usage())
    return 0
  }
  if (command === '--version' || command === '-v') {
    if (subcommand !== undefined) throw new Error('--version does not accept arguments.')
    console.log(packageVersion())
    return 0
  }
  if (command === 'convex') {
    if (!subcommand) throw new Error('The convex command requires a Convex subcommand.')
    return await runConvexCommand([subcommand, ...rest])
  }
  if (command === 'auth' && subcommand === 'schema') {
    return await runAuthSchemaCommand(rest)
  }
  if (command === 'init') {
    return await runInitCommand(subcommand ? [subcommand, ...rest] : rest)
  }
  throw new Error(`Unknown command: ${command}`)
}

let invokedAsScript = false
if (process.argv[1]) {
  try {
    invokedAsScript = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    // An unresolved entry path cannot identify this module as the executable.
  }
}

if (invokedAsScript) {
  try {
    process.exitCode = await runBetterConvexCommand(process.argv.slice(2))
  } catch (error) {
    console.error(`[better-convex] ${error instanceof Error ? error.message : 'failed'}`)
    process.exitCode = 1
  }
}
