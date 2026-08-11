#!/usr/bin/env node

import { constants } from 'node:fs'
import { access, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'

import type { BetterAuthOptions } from 'better-auth'
import { getAuthTables } from 'better-auth/db'
import { createJiti } from 'jiti'

import { generateAuthSchemaArtifacts } from '../convex-auth/adapter/generate-schema'

const SCHEMA_BASE_URL = 'https://schema.invalid'
const SCHEMA_SECRET = 'schema-generation-only-value-never-used-at-runtime'
const CLEARED_ENVIRONMENT = [
  'SITE_URL',
  'CONVEX_SITE_URL',
  'AUTH_SECRET',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_SECRETS',
  'BCN_AUTH_PROXY_IP_SECRET',
] as const

interface CliOptions {
  check: boolean
  config?: string
  help: boolean
  output?: string
}

function usage(): string {
  return [
    'Generate a paired Better Convex Nuxt local auth schema and metadata descriptor.',
    '',
    'Usage:',
    '  better-convex-nuxt-auth-schema --config <schema-options.ts> [--output <directory>] [--check]',
    '',
    'The config must default-export environment-independent BetterAuthOptions using:',
    `  baseURL: ${SCHEMA_BASE_URL}`,
    `  secret: ${SCHEMA_SECRET}`,
    '',
    'The config is loaded as TypeScript and may import local schema plugin modules.',
  ].join('\n')
}

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
  return value
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { check: false, help: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    switch (argument) {
      case '--check':
        options.check = true
        break
      case '--config':
        if (options.config) throw new Error('--config may be provided only once.')
        options.config = valueAfter(args, index, '--config')
        index += 1
        break
      case '--help':
      case '-h':
        options.help = true
        break
      case '--output':
        if (options.output) throw new Error('--output may be provided only once.')
        options.output = valueAfter(args, index, '--output')
        index += 1
        break
      default:
        throw new Error(`Unknown argument: ${argument}`)
    }
  }
  return options
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireSchemaOptions(value: unknown): BetterAuthOptions {
  if (!isRecord(value)) throw new Error('Schema config must default-export BetterAuthOptions.')
  if (value.baseURL !== SCHEMA_BASE_URL || value.secret !== SCHEMA_SECRET) {
    throw new Error(
      'Schema config must use the reserved environment-independent baseURL and secret.',
    )
  }
  return value as BetterAuthOptions
}

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function resolveSchemaTarget(configPath: string, output: string | undefined): string {
  const resolvedOutput = output ? resolve(output) : dirname(configPath)
  const target =
    output && extname(resolvedOutput) ? resolvedOutput : join(resolvedOutput, 'schema.ts')
  if (basename(target) !== 'schema.ts' || basename(dirname(target)) === 'convex') {
    throw new Error('Output must be a local component schema.ts, not the application schema.')
  }
  return target
}

async function writePair(outputs: ReadonlyMap<string, string>): Promise<void> {
  const temporaryFiles = new Map<string, string>()
  const sequence = `${process.pid}.${Date.now()}`
  try {
    for (const [target, contents] of outputs) {
      await mkdir(dirname(target), { recursive: true })
      const temporary = join(dirname(target), `.${basename(target)}.${sequence}.tmp`)
      await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
      temporaryFiles.set(target, temporary)
    }
    // Metadata first: interruption before the matching schema rename is
    // detected by the runtime fingerprint check and therefore fails closed.
    const orderedTargets = [...outputs.keys()].sort((left, right) =>
      left.endsWith('schemaMetadata.ts') ? -1 : right.endsWith('schemaMetadata.ts') ? 1 : 0,
    )
    for (const target of orderedTargets) {
      const temporary = temporaryFiles.get(target)
      if (!temporary) throw new Error('Unable to stage generated auth artifacts.')
      await rename(temporary, target)
      temporaryFiles.delete(target)
    }
  } finally {
    await Promise.all([...temporaryFiles.values()].map((path) => rm(path, { force: true })))
  }
}

async function generate(options: CliOptions): Promise<number> {
  if (!options.config) throw new Error('--config is required.')
  const configPath = await realpath(resolve(options.config))
  await access(configPath, constants.R_OK)

  for (const name of CLEARED_ENVIRONMENT) Reflect.deleteProperty(process.env, name)

  let configModule: Record<string, unknown>
  try {
    const jiti = createJiti(import.meta.url, { interopDefault: false })
    configModule = (await jiti.import(configPath)) as Record<string, unknown>
  } catch (error) {
    if (isRecord(error) && error.code === 'ERR_MODULE_NOT_FOUND') {
      // The import error may contain environment or filesystem detail. This CLI
      // boundary deliberately emits only the fixed reviewed message.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Unable to import schema config or one of its dependencies.')
    }
    throw error
  }
  const schemaOptions = requireSchemaOptions(configModule.default)
  const artifacts = generateAuthSchemaArtifacts(getAuthTables(schemaOptions))
  const schemaTarget = resolveSchemaTarget(configPath, options.output)
  const outputs = new Map([
    [schemaTarget, artifacts.schemaCode],
    [join(dirname(schemaTarget), 'schemaMetadata.ts'), artifacts.metadataCode],
  ])

  if (options.check) {
    const stale: string[] = []
    for (const [target, contents] of outputs) {
      if ((await readIfPresent(target)) !== contents) stale.push(target)
    }
    if (stale.length > 0) {
      for (const target of stale) console.error(`stale: ${target}`)
      return 1
    }
    console.log('Auth schema and metadata are current.')
    return 0
  }

  await writePair(outputs)
  for (const target of outputs.keys()) console.log(`generated: ${target}`)
  return 0
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return 0
  }
  return await generate(options)
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(
    `[better-convex-nuxt-auth-schema] ${error instanceof Error ? error.message : 'failed'}`,
  )
  process.exitCode = 1
}
