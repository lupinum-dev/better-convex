import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const jiti = path.join(root, 'node_modules/jiti/lib/jiti-cli.mjs')
const cli = path.join(root, 'src/runtime/cli/auth-schema.ts')
const check = process.argv.includes('--check')
const unknown = process.argv.slice(2).filter((argument) => argument !== '--check')

if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`)

const targets = [
  {
    config: 'internal/convex-auth/schema-options.ts',
    output: 'src/runtime/convex-auth/component',
  },
  {
    config: 'starters/team/convex/betterAuth/schemaOptions.ts',
    output: 'starters/team/convex/betterAuth',
  },
  {
    config: 'test/fixtures/better-auth-local-component/convex/betterAuth/schemaOptions.ts',
    output: 'test/fixtures/better-auth-local-component/convex/betterAuth',
  },
  {
    config: 'test/fixtures/better-auth-two-factor/convex/betterAuth/schemaOptions.ts',
    output: 'test/fixtures/better-auth-two-factor/convex/betterAuth',
  },
]

for (const target of targets) {
  execFileSync(
    process.execPath,
    [
      jiti,
      cli,
      '--config',
      target.config,
      '--output',
      target.output,
      ...(check ? ['--check'] : []),
    ],
    { cwd: root, stdio: 'inherit' },
  )
}
