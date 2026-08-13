import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const config = JSON.parse(readFileSync(resolve(root, 'docs/vercel.json'), 'utf8'))
const docsWorkspace = readFileSync(resolve(root, 'docs/pnpm-workspace.yaml'), 'utf8')
const demoWorkspace = readFileSync(resolve(root, 'demo/pnpm-workspace.yaml'), 'utf8')
const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}

check(!existsSync(resolve(root, 'vercel.json')), 'Keep vercel.json in the deployable docs app.')
check(!existsSync(resolve(root, 'demo/vercel.json')), 'The example application must not deploy.')
check(config.framework === 'nuxtjs', 'Select the Nuxt framework explicitly.')
check(config.outputDirectory === null, 'Let Nuxt and Vercel detect .vercel/output.')
check(config.buildCommand === 'pnpm build', 'Build the documentation app directly.')
check(
  config.installCommand?.includes('pnpm install --frozen-lockfile'),
  'Install the documentation lockfile.',
)
check(
  docsWorkspace.includes('minimumReleaseAge: 1440'),
  'Quarantine fresh documentation dependencies for 24 hours.',
)
check(
  demoWorkspace.includes('minimumReleaseAge: 1440'),
  'Quarantine fresh demo dependencies for 24 hours.',
)

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Vercel app-root contract: ok')
