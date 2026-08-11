import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const repoRoot = new URL('..', import.meta.url).pathname
const startersDir = join(repoRoot, 'starters')
const generatedNames = ['.convex', '.nuxt', '.output', 'node_modules', 'dist']
const forbiddenPayloadNames = ['.agents', '.claude', '.env.local', 'CLAUDE.md', 'skills-lock.json']
const retainedGeneratedFiles = new Set([
  'starters/agency/convex/_generated/api.d.ts',
  'starters/agency/convex/_generated/api.js',
  'starters/agency/convex/_generated/dataModel.d.ts',
  'starters/agency/convex/_generated/server.d.ts',
  'starters/agency/convex/_generated/server.js',
  'starters/mcp-oauth-agent/convex/_generated/api.d.ts',
  'starters/mcp-oauth-agent/convex/_generated/api.js',
  'starters/mcp-oauth-agent/convex/_generated/dataModel.d.ts',
  'starters/mcp-oauth-agent/convex/_generated/server.d.ts',
  'starters/mcp-oauth-agent/convex/_generated/server.js',
  'starters/public/convex/_generated/api.d.ts',
  'starters/public/convex/_generated/api.js',
  'starters/public/convex/_generated/dataModel.d.ts',
  'starters/public/convex/_generated/server.d.ts',
  'starters/public/convex/_generated/server.js',
  'starters/team/convex/_generated/ai/ai-files.state.json',
  'starters/team/convex/_generated/ai/guidelines.md',
  'starters/team/convex/_generated/api.d.ts',
  'starters/team/convex/_generated/api.js',
  'starters/team/convex/_generated/dataModel.d.ts',
  'starters/team/convex/_generated/server.d.ts',
  'starters/team/convex/_generated/server.js',
  'starters/team/convex/betterAuth/_generated/api.ts',
  'starters/team/convex/betterAuth/_generated/component.ts',
  'starters/team/convex/betterAuth/_generated/dataModel.ts',
  'starters/team/convex/betterAuth/_generated/server.ts',
])

const offenders = []
const actualGeneratedFiles = new Set()

function collectGeneratedFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectGeneratedFiles(fullPath)
    } else if (entry.isFile()) {
      actualGeneratedFiles.add(relative(repoRoot, fullPath).split('\\').join('/'))
    }
  }
}

function collectEmittedJavaScriptArtifacts(dir, relativeDir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.nuxt' || entry.name === '.output') {
      continue
    }

    const fullPath = join(dir, entry.name)
    const relativePath = `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name === '_generated') collectGeneratedFiles(fullPath)
      else collectEmittedJavaScriptArtifacts(fullPath, relativePath)
      continue
    }

    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      continue
    }

    const sourcePath = fullPath.slice(0, -'.js'.length) + '.ts'
    if (existsSync(sourcePath)) {
      offenders.push(relativePath)
    }
  }
}

function checkGeneratedApiModules(starter) {
  const convexDir = join(startersDir, starter, 'convex')
  const generatedApi = readFileSync(join(convexDir, '_generated', 'api.d.ts'), 'utf8')
  const generatedModules = new Set(
    [...generatedApi.matchAll(/import type \* as \S+ from "\.\.\/(.+)\.js";/g)].map(
      (match) => match[1],
    ),
  )
  const expectedModules = new Set(
    readdirSync(convexDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => entry.name.slice(0, -3))
      .filter(
        (name) =>
          !name.endsWith('.test') &&
          !name.endsWith('.config') &&
          name !== 'schema' &&
          name !== 'test.setup',
      ),
  )
  for (const name of expectedModules) {
    if (!generatedModules.has(name)) {
      offenders.push(`starters/${starter}/convex/_generated/api.d.ts (missing module ${name})`)
    }
  }
  for (const name of generatedModules) {
    if (!expectedModules.has(name)) {
      offenders.push(`starters/${starter}/convex/_generated/api.d.ts (stale module ${name})`)
    }
  }
}

for (const starter of ['agency', 'public']) checkGeneratedApiModules(starter)

for (const entry of readdirSync(startersDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue

  for (const generatedName of generatedNames) {
    const generatedPath = join(startersDir, entry.name, generatedName)
    if (existsSync(generatedPath)) {
      offenders.push(`starters/${entry.name}/${generatedName}`)
    }
  }

  for (const forbiddenName of forbiddenPayloadNames) {
    const forbiddenPath = join(startersDir, entry.name, forbiddenName)
    if (existsSync(forbiddenPath)) {
      offenders.push(`starters/${entry.name}/${forbiddenName}`)
    }
  }

  collectEmittedJavaScriptArtifacts(join(startersDir, entry.name), `starters/${entry.name}`)
}

for (const path of actualGeneratedFiles) {
  if (!retainedGeneratedFiles.has(path)) offenders.push(`${path} (unclassified generated file)`)
}
for (const path of retainedGeneratedFiles) {
  if (!actualGeneratedFiles.has(path)) offenders.push(`${path} (missing retained generated file)`)
}

if (offenders.length > 0) {
  console.error('Starter generated artifacts must not be kept in this repository:')
  for (const offender of offenders) {
    console.error(`- ${offender}`)
  }
  console.error('\nRemove them with:')
  console.error(
    'find starters -maxdepth 2 \\( -name .convex -o -name .nuxt -o -name .output -o -name node_modules -o -name dist -o -name .agents -o -name .claude \\) -type d -prune -exec rm -rf {} +',
  )
  console.error(
    'find starters -maxdepth 2 \\( -name .env.local -o -name CLAUDE.md -o -name skills-lock.json \\) -type f -delete',
  )
  console.error(
    'find starters -path "*/_generated" -prune -o -name "*.js" -exec sh -c \'for f; do [ -f "${f%.js}.ts" ] && rm "$f"; done\' sh {} +',
  )
  process.exit(1)
}
