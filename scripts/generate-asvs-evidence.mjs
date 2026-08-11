#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const root = process.cwd()
const inputPath = resolve(root, 'security/asvs-5.0.0-l2-evidence.json')
const outputPath = resolve(root, 'security/asvs-5-level-2-evidence.md')
const packagePath = resolve(root, 'package.json')
const expectedRequirementCount = 253
const expectedRequirementSetSha256 =
  'ab3851f4fd75c5ac6b666ccd2fce4c1ff0bbb464da480d9730b341c4cccc4925'
const allowedResponsibilities = new Set([
  'library',
  'consumer',
  'deployment',
  'upstream',
  'not-applicable',
])
const evidence = JSON.parse(readFileSync(inputPath, 'utf8'))
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))

if (evidence.standard !== 'OWASP ASVS' || evidence.version !== '5.0.0') {
  throw new Error('ASVS evidence must target the stable OWASP ASVS 5.0.0 release.')
}
if (evidence.requirements.length !== expectedRequirementCount) {
  throw new Error(
    `ASVS evidence contains ${evidence.requirements.length} controls; expected ${expectedRequirementCount}.`,
  )
}

const requirementSetSha256 = createHash('sha256')
  .update(
    evidence.requirements
      .map((control) => `${control.id}:${control.level}`)
      .sort()
      .join('\n'),
  )
  .digest('hex')
if (
  requirementSetSha256 !== expectedRequirementSetSha256 ||
  evidence.requirementSetSha256 !== expectedRequirementSetSha256
) {
  throw new Error('ASVS requirement IDs or levels differ from the pinned 5.0.0 Level 2 set.')
}

const ids = new Set()
for (const control of evidence.requirements) {
  if (!/^v5\.0\.0-\d+\.\d+\.\d+$/.test(control.id)) {
    throw new Error(`Invalid versioned ASVS identifier: ${control.id}`)
  }
  if (ids.has(control.id)) throw new Error(`Duplicate ASVS identifier: ${control.id}`)
  ids.add(control.id)
  if (control.level !== 1 && control.level !== 2) {
    throw new Error(`${control.id} has unsupported level ${control.level}.`)
  }
  if (!allowedResponsibilities.has(control.responsibility)) {
    throw new Error(`${control.id} has invalid responsibility ${control.responsibility}.`)
  }
  if (!control.evidence || /\b(?:TBD|TODO)\b/i.test(control.evidence)) {
    throw new Error(`${control.id} has incomplete evidence.`)
  }
  const expectedStatus = control.responsibility === 'library' ? 'verified' : 'external'
  if (control.status !== expectedStatus) {
    throw new Error(`${control.id} must have status ${expectedStatus}.`)
  }
  if (control.status === 'verified' && !existsSync(resolve(root, control.evidence))) {
    throw new Error(`${control.id} references missing evidence: ${control.evidence}`)
  }
}

if (!Array.isArray(evidence.authInvariants)) {
  throw new TypeError('ASVS evidence must contain a top-level authInvariants array.')
}

const authInvariantIds = evidence.authInvariants.map((invariant) => invariant.id)
if (
  authInvariantIds.length === 0 ||
  authInvariantIds.some((id) => !/^AUTH-INV-\d+[A-Z]?$/.test(id))
) {
  throw new Error('ASVS evidence contains an invalid authentication invariant ID.')
}
if (new Set(authInvariantIds).size !== authInvariantIds.length) {
  throw new Error('ASVS evidence contains duplicate authentication invariant IDs.')
}

const invariantKeys = ['asvs', 'commands', 'evidence', 'id']
for (const invariant of evidence.authInvariants) {
  const actualKeys = Object.keys(invariant).sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(invariantKeys)) {
    throw new Error(
      `${invariant.id ?? 'Authentication invariant'} must contain exactly: ${invariantKeys.join(', ')}.`,
    )
  }

  for (const field of ['asvs', 'commands', 'evidence']) {
    const values = invariant[field]
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      values.some((value) => typeof value !== 'string' || value.trim() !== value || !value)
    ) {
      throw new Error(`${invariant.id}.${field} must be a non-empty array of trimmed strings.`)
    }
    if (new Set(values).size !== values.length) {
      throw new Error(`${invariant.id}.${field} contains duplicate entries.`)
    }
  }

  for (const asvsId of invariant.asvs) {
    if (!ids.has(asvsId)) {
      throw new Error(`${invariant.id} references unknown Level 2 ASVS control: ${asvsId}`)
    }
  }

  for (const command of invariant.commands) {
    const match = /^pnpm(?: run)? ([\w:.-]+)$/.exec(command)
    if (!match || !packageJson.scripts?.[match[1]]) {
      throw new Error(`${invariant.id} references an unknown root package script: ${command}`)
    }
  }

  for (const evidencePath of invariant.evidence) {
    const absolutePath = resolve(root, evidencePath)
    const repositoryPath = relative(root, absolutePath)
    if (
      isAbsolute(evidencePath) ||
      !repositoryPath ||
      repositoryPath === '..' ||
      repositoryPath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
      !existsSync(absolutePath) ||
      !statSync(absolutePath).isFile()
    ) {
      throw new Error(`${invariant.id} references invalid evidence path: ${evidencePath}`)
    }
  }
}

const chapters = new Map()
for (const control of evidence.requirements) {
  const row = chapters.get(control.chapter) ?? { total: 0, library: 0, external: 0 }
  row.total += 1
  if (control.status === 'verified') row.library += 1
  else row.external += 1
  chapters.set(control.chapter, row)
}

const lines = [
  '# OWASP ASVS 5.0.0 Level 2 evidence map',
  '',
  'This is a complete responsibility and evidence index for all 253 Level 1 and Level 2 controls in the stable OWASP ASVS 5.0.0 release. It is not an ASVS certification of consumer applications or deployments.',
  '',
  'Canonical evidence: `security/asvs-5.0.0-l2-evidence.json`',
  '',
  `Source: ${evidence.source}`,
  '',
  '## Coverage summary',
  '',
  '| Chapter | Controls | Library verified | External responsibility |',
  '| --- | ---: | ---: | ---: |',
]

for (const [chapter, counts] of chapters) {
  lines.push(`| ${chapter} | ${counts.total} | ${counts.library} | ${counts.external} |`)
}

lines.push(
  '',
  '## Library-owned verified controls',
  '',
  '| ASVS control | Evidence |',
  '| --- | --- |',
)
for (const control of evidence.requirements.filter((item) => item.status === 'verified')) {
  lines.push(`| ${control.id} | \`${control.evidence}\` |`)
}

lines.push(
  '',
  '## Authentication invariant map',
  '',
  'This map is generated from the canonical ASVS evidence JSON. The generator validates unique invariant IDs, every ASVS control, every root package command, and every repository evidence path.',
  '',
  '| Invariant | ASVS controls | Verification commands | Evidence |',
  '| --- | --- | --- | --- |',
)
for (const invariant of evidence.authInvariants) {
  lines.push(
    `| ${invariant.id} | ${invariant.asvs.map((value) => `\`${value}\``).join('<br>')} | ${invariant.commands.map((value) => `\`${value}\``).join('<br>')} | ${invariant.evidence.map((value) => `\`${value}\``).join('<br>')} |`,
  )
}

lines.push(
  '',
  '## Responsibility meanings',
  '',
  '- **library**: implemented and backed by repository evidence.',
  '- **upstream**: owned by the pinned Better Auth or Convex implementation and requiring integration verification.',
  '- **consumer**: owned by authorization and application code using this library.',
  '- **deployment**: owned by production infrastructure, configuration, monitoring, and operations.',
  '- **not-applicable**: functionality is not implemented by this library.',
  '',
  'A release may claim only that the library-owned controls are verified. External controls must be assessed against the deployed consumer application before making an application-level ASVS claim.',
  '',
)

const rendered = execFileSync(
  resolve(root, 'node_modules', '.bin', process.platform === 'win32' ? 'oxfmt.cmd' : 'oxfmt'),
  ['--stdin-filepath', outputPath],
  {
    cwd: root,
    encoding: 'utf8',
    input: `${lines.join('\n')}\n`,
  },
)
if (process.argv.includes('--check')) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : ''
  if (current !== rendered) {
    console.error('ASVS evidence report is stale. Run `pnpm docs:asvs`.')
    process.exit(1)
  }
  console.log(
    `ASVS evidence passed (${evidence.requirements.length} controls, ${ids.size} unique, ${evidence.authInvariants.length} auth invariants).`,
  )
} else if (process.argv.includes('--stdout')) {
  process.stdout.write(rendered)
} else {
  writeFileSync(outputPath, rendered)
  console.log(`Generated ${outputPath}`)
}
